import type { APIRoute } from "astro";
import { deleteRegistry, getTransactionCount, renameRegistry } from "@/lib/store";

export const PATCH: APIRoute = async (ctx) => {
  const id = ctx.params.id!;
  const systemUserId = ctx.locals.user?.id;
  if (!systemUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rename is owner-only (membership isn't enough).
  if (!ctx.locals.ownerRegistryIds.has(id)) {
    return Response.json(
      { error: "Only owners can rename" },
      {
        status: 403,
      },
    );
  }

  const body = await ctx.request.json();
  const name = (body.name as string)?.trim();
  if (!name) {
    return Response.json({ error: "Name required" }, { status: 400 });
  }

  const updated = await renameRegistry(id, name, systemUserId);
  if (!updated) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(updated);
};

export const DELETE: APIRoute = async (ctx) => {
  const id = ctx.params.id!;
  const systemUserId = ctx.locals.user?.id;
  if (!systemUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Delete is owner-only; deleteRegistry re-checks ownership in SQL too.
  if (!ctx.locals.ownerRegistryIds.has(id)) {
    return Response.json(
      { error: "Only owners can delete" },
      {
        status: 403,
      },
    );
  }

  const txCount = await getTransactionCount(id);
  if (txCount > 0) {
    return Response.json(
      { error: "Registry has transactions" },
      {
        status: 409,
      },
    );
  }

  const deleted = await deleteRegistry(id, systemUserId);
  if (!deleted) {
    return Response.json({ error: "Delete failed" }, { status: 500 });
  }

  return new Response(null, { status: 204 });
};
