import type { APIRoute } from "astro";
import { deleteEntity, updateEntity } from "@/lib/store";
import { invalidateRegistry } from "@/lib/server-cache";

export const PUT: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = ctx.params.id!;
  const body = await ctx.request.json();
  const { name, color } = body;

  if (!name || !name.trim()) {
    return Response.json({ error: "Nombre requerido" }, { status: 400 });
  }

  const registryId = ctx.locals.activeRegistry?.id;
  if (!registryId) {
    return Response.json({ error: "Sin registro activo" }, { status: 400 });
  }

  const entity = await updateEntity(
    registryId,
    id,
    name.trim(),
    color,
    userId,
  );
  if (!entity) {
    return Response.json({ error: "Entidad no encontrada" }, { status: 404 });
  }

  invalidateRegistry(registryId);

  return Response.json({
    id: entity.id,
    name: entity.name,
    color: entity.color,
  });
};

export const DELETE: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = ctx.params.id!;
  const registryId = ctx.locals.activeRegistry?.id;
  if (!registryId) {
    return Response.json({ error: "Sin registro activo" }, { status: 400 });
  }

  const deleted = await deleteEntity(registryId, id, userId);
  if (!deleted) {
    return Response.json({
      error: "No se puede eliminar: tiene transacciones activas",
    }, { status: 409 });
  }

  invalidateRegistry(registryId);

  return new Response(null, { status: 204 });
};
