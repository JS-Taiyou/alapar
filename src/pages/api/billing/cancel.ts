import type { APIRoute } from "astro";
import { query } from "@/lib/db";
import {
  billingConfigured,
  cancelSubscriptionAtPeriodEnd,
} from "@/lib/billing";

/**
 * POST /api/billing/cancel — schedules (or undoes) a cancel-at-period-end
 * for the CURRENT user's subscription (subscriptions are per-user; one
 * covers every registry the subscriber owns).
 *
 * Body: `{ undo?: boolean }`. The subscription stays ACTIVE until
 * `current_period_end` (Polar semantics), so the user keeps Pro for the
 * time they paid for; `undo: true` reactivates it.
 *
 * The Polar mirror's `cancel_at_period_end` flag is only written here on a
 * successful Polar call — if the PATCH fails, nothing changes locally (the
 * webhook remains the authoritative writer for everything else).
 */
export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await ctx.request.json().catch(() => ({}));
  const undo = (body as { undo?: boolean }).undo === true;

  if (!billingConfigured()) {
    return Response.json({ error: "Billing is not configured" }, {
      status: 503,
    });
  }

  const sub = await query(
    `SELECT polar_subscription_id, current_period_end
     FROM registry_subscriptions WHERE user_id = $1`,
    [userId],
  );
  const row = sub.rows[0] as
    | { polar_subscription_id?: string; current_period_end?: string | null }
    | undefined;
  if (!row?.polar_subscription_id) {
    return Response.json(
      { error: "No subscription found for this account" },
      { status: 404 },
    );
  }

  const ok = await cancelSubscriptionAtPeriodEnd(
    row.polar_subscription_id,
    !undo,
  );
  if (!ok) {
    return Response.json(
      { error: "Polar rejected the cancellation request" },
      { status: 502 },
    );
  }

  await query(
    `UPDATE registry_subscriptions
     SET cancel_at_period_end = $2, updated_at = now()
     WHERE user_id = $1`,
    [userId, !undo],
  );

  return Response.json({
    ok: true,
    activeUntil: row.current_period_end ?? null,
  });
};
