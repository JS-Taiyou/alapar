import type { APIRoute } from "astro";
import {
  clearDefaultSplitForOwner,
  getEntities,
  getUsers,
  setDefaultSplit,
} from "@/lib/store";

export const POST: APIRoute = async (ctx) => {
  const body = await ctx.request.json();
  const { registryId, splits } = body as {
    registryId: string;
    splits: { userId: string; percentage: number }[];
  };

  if (!registryId || !splits || !Array.isArray(splits)) {
    return Response.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const userId = ctx.locals.user?.id;
  // Ownership of the TARGET registry (not just the active one).
  if (!userId || !ctx.locals.ownerRegistryIds.has(registryId)) {
    return Response.json({ error: "Solo el owner puede configurar esto" }, {
      status: 403,
    });
  }

  const total = splits.reduce((s, sp) => s + sp.percentage, 0);
  if (Math.abs(total - 100) >= 0.01) {
    return Response.json({ error: "Los porcentajes deben sumar 100%" }, {
      status: 400,
    });
  }

  // Validate split userIds against the TARGET registry's participants
  // (ctx.locals.participants only describes the active registry).
  let participantIds: string[];
  if (registryId === ctx.locals.activeRegistry?.id) {
    participantIds = ctx.locals.participants.map((u) => u.id);
  } else {
    const [users, entities] = await Promise.all([
      getUsers(registryId),
      getEntities(registryId, userId),
    ]);
    participantIds = [
      ...users.map((u) => u.id),
      ...entities.map((e) => e.id),
    ];
  }
  const allValid = splits.every((s) => participantIds.includes(s.userId));
  if (!allValid) {
    return Response.json({ error: "Usuario no encontrado en el registro" }, {
      status: 400,
    });
  }

  if (splits.length === 0) {
    await clearDefaultSplitForOwner(registryId, userId);
  } else {
    await setDefaultSplit(registryId, splits, userId);
  }

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async (ctx) => {
  const body = await ctx.request.json();
  const { registryId } = body as { registryId: string };

  if (!registryId) {
    return Response.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const userId = ctx.locals.user?.id;
  if (!userId || !ctx.locals.ownerRegistryIds.has(registryId)) {
    return Response.json({ error: "Solo el owner" }, { status: 403 });
  }

  await clearDefaultSplitForOwner(registryId, userId);
  return Response.json({ ok: true });
};
