import { bumpRegistryVersion } from "@/lib/registry-version";
import type { APIRoute } from "astro";
import { query } from "@/lib/db";
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

/**
 * POST /api/exercises — settle (cortar) the current period.
 *
 * Delegates entirely to the perform_corte() PL/pgSQL function (see
 * db/perform_corte.sql): ONE round-trip instead of the previous JS loop's
 * ~44 (4 per pairwise ajuste). The function archives transactions,
 * computes pairwise debts from transaction_balances, creates ajustes,
 * writes their deltas, and touches the registry stamp — all atomic.
 */
export const POST: APIRoute = async (ctx) => {
  let body: { registryId?: unknown } = {};
  const hasJsonBody = (ctx.request.headers.get("content-type") ?? "").includes("application/json");
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

  const requestedRegistryId = typeof body.registryId === "string" ? body.registryId : undefined;
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
  // perform_corte re-checks ownership inside the DB too.
  if (!ctx.locals.ownerRegistryIds.has(registryId)) {
    const accept = ctx.request.headers.get("Accept") ?? "";
    if (accept.includes("application/json")) {
      return Response.json({ error: "Only owners can close an exercise" }, { status: 403 });
    }
    return ctx.redirect("/dashboard");
  }

  try {
    const result = await query("SELECT * FROM perform_corte($1::uuid, $2::uuid)", [
      registryId,
      userId,
    ]);
    const row = result.rows[0] as {
      out_exercise_id: string;
      out_exercise_start: string;
      out_exercise_end: string;
      out_tx_count: string;
      out_total_amount: string;
      out_adjustments: number;
    };

    invalidateRegistry(registryId);
    void bumpRegistryVersion(registryId);

    const exercise = {
      id: row.out_exercise_id,
      registry_id: registryId,
      start_date: row.out_exercise_start,
      end_date: row.out_exercise_end,
      transaction_count: parseInt(String(row.out_tx_count)),
      total_amount: parseFloat(row.out_total_amount),
    };

    const accept = ctx.request.headers.get("Accept") ?? "";
    if (accept.includes("application/json")) {
      return Response.json({ exercise, adjustments: row.out_adjustments });
    }
    return ctx.redirect("/dashboard");
  } catch (err) {
    // perform_corte raises specific exceptions for the known guards;
    // surface those as structured errors, anything else as 500.
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("not_owner")) {
      return Response.json({ error: "Only owners can close an exercise" }, { status: 403 });
    }
    if (msg.includes("no_active_transactions")) {
      const accept = ctx.request.headers.get("Accept") ?? "";
      if (accept.includes("application/json")) {
        return Response.json({ exercise: null, transactions: [] });
      }
      return ctx.redirect("/dashboard");
    }
    throw err;
  }
};
