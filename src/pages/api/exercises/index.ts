import type { APIRoute } from "astro";
import {
  calculateFullPairwiseBalances,
  createExercise,
  createTransaction,
  getActiveTransactions,
  getEntities,
  getUsers,
} from "@/lib/store";
import { withTransaction } from "@/lib/db";
import { invalidateRegistry } from "@/lib/server-cache";

export const GET: APIRoute = async (ctx) => {
  const registryId = ctx.locals.activeRegistry?.id;
  if (!registryId) {
    return Response.json({ exercises: [] });
  }
  const { getExercises } = await import("@/lib/store");
  const exercises = await getExercises(registryId);
  return Response.json({ exercises });
};

export const POST: APIRoute = async (ctx) => {
  let body: { registryId?: unknown } = {};
  const hasJsonBody = (ctx.request.headers.get("content-type") ?? "").includes(
    "application/json",
  );
  if (hasJsonBody) {
    try {
      body = await ctx.request.json();
    } catch {
      const accept = ctx.request.headers.get("Accept") ?? "";
      if (accept.includes("application/json")) {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      return ctx.redirect("/dashboard");
    }
  }

  const requestedRegistryId = typeof body.registryId === "string"
    ? body.registryId
    : undefined;
  const registryId = requestedRegistryId ?? ctx.locals.activeRegistry?.id;
  const userId = ctx.locals.user?.id;
  if (!registryId || !userId) {
    const accept = ctx.request.headers.get("Accept") ?? "";
    if (accept.includes("application/json")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return ctx.redirect("/dashboard");
  }

  // Closing an exercise is destructive and owner-only (S8) — for the
  // active registry too, not just when a different one is requested.
  if (!ctx.locals.ownerRegistryIds.has(registryId)) {
    const accept = ctx.request.headers.get("Accept") ?? "";
    if (accept.includes("application/json")) {
      return Response.json({ error: "Only owners can close an exercise" }, {
        status: 403,
      });
    }
    return ctx.redirect("/dashboard");
  }

  const active = await getActiveTransactions(registryId);
  if (active.length === 0) {
    const accept = ctx.request.headers.get("Accept") ?? "";
    if (accept.includes("application/json")) {
      return Response.json({ exercise: null, transactions: [] });
    }
    return ctx.redirect("/dashboard");
  }

  const [users, entities] = await Promise.all([
    getUsers(registryId),
    getEntities(registryId, userId),
  ]);
  const participants = [
    ...users.map((u) => ({ id: u.id, name: u.name, color: u.color })),
    ...entities.map((e) => ({ id: e.id, name: e.name, color: e.color })),
  ];
  const debts = calculateFullPairwiseBalances(active, participants);

  const totalPending = debts.reduce((sum, d) => sum + d.amount, 0);
  const maxRoundingError = 0.01 * active.length;

  // Archiving the period and writing the carry-forward ajustes are ONE
  // unit: if the ajuste writes fail, the archive rolls back too, so a
  // crash mid-cut can never leave a period settled-without-its-debts.
  const exercise = await withTransaction(async (q) => {
    const created = await createExercise(registryId, q);

    if (totalPending > maxRoundingError) {
      for (const debt of debts) {
        const ajuste = await createTransaction(
          {
            registry_id: registryId,
            description:
              `Pendiente de ${debt.fromUserName} a favor de ${debt.toUserName}`,
            amount: debt.amount,
            originalAmount: debt.amount,
            type: "ajuste" as const,
            relatedTransactionId: null,
            exerciseId: null,
            installmentCurrent: null,
            installmentTotal: null,
            recurringDisabled: false,
            recurringGroupId: crypto.randomUUID(),
            notes: "Ajuste de balance pendiente del ejercicio anterior",
            splitJson: {
              splits: [{
                userId: debt.fromUserId,
                percentage: 100,
                amount: debt.amount,
              }],
            },
            creatorId: debt.toUserId,
            userPaid: debt.toUserId,
          },
          userId,
          undefined,
          q,
        );
        if (!ajuste) {
          // Membership vanished mid-cut (checked per write). Abort the
          // whole cut rather than archive without the ajustes.
          throw new Error("registry membership lost during cut");
        }
      }
    }

    return created;
  });
  invalidateRegistry(registryId);

  const accept = ctx.request.headers.get("Accept") ?? "";
  if (accept.includes("application/json")) {
    return Response.json({
      exercise,
      transactions: totalPending > maxRoundingError ? debts : [],
    });
  }
  return ctx.redirect("/dashboard");
};
