import { bumpRegistryVersion } from "@/lib/registry-version";
import type { APIRoute } from "astro";
import { createEntity, getEntities } from "@/lib/store";
import { invalidateRegistry } from "@/lib/server-cache";

export const GET: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const registryId = ctx.url.searchParams.get("registryId") || ctx.locals.activeRegistry?.id;
  if (!registryId) {
    return Response.json([]);
  }

  // Mirror the POST membership check: a registryId the user doesn't belong
  // to must not leak its entities.
  const isMember = ctx.locals.registries.some((r) => r.id === registryId);
  if (!isMember) {
    return Response.json({ error: "No eres miembro" }, { status: 403 });
  }

  const entities = await getEntities(registryId, userId);
  return Response.json(
    entities.map((e) => ({
      id: e.id,
      name: e.name,
      color: e.color,
    })),
  );
};

export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await ctx.request.json();
  const { name, color, registryId } = body;

  if (!name || !name.trim()) {
    return Response.json({ error: "Nombre requerido" }, { status: 400 });
  }

  const activeRegistryId = registryId || ctx.locals.activeRegistry?.id;
  if (!activeRegistryId) {
    return Response.json({ error: "Sin registro activo" }, { status: 400 });
  }

  const isMember = ctx.locals.registries.some((r) => r.id === activeRegistryId);
  if (!isMember) {
    return Response.json({ error: "No eres miembro" }, { status: 403 });
  }

  const entity = await createEntity(activeRegistryId, name.trim(), color, userId);
  if (!entity) {
    return Response.json({ error: "No eres miembro" }, { status: 403 });
  }

  invalidateRegistry(activeRegistryId);
  void bumpRegistryVersion(activeRegistryId);

  return Response.json(
    {
      id: entity.id,
      name: entity.name,
      color: entity.color,
    },
    { status: 201 },
  );
};
