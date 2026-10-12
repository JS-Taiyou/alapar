import type { APIRoute } from "astro";
import { query } from "@/lib/db";
import {
  billingConfigured,
  getPolarProductIds,
  getSubscription,
  switchSubscriptionProduct,
} from "@/lib/billing";

/**
 * POST /api/billing/switch — move the CURRENT user's subscription to the
 * other billing interval (monthly ↔ yearly), prorated, on the SAME
 * subscription.
 *
 * Body: `{ interval: "monthly" | "yearly" }`.
 *
 * This is the correct "upgrade/downgrade" path per Polar's API: PATCH the
 * subscription with the target product_id and proration_behavior — Polar
 * credits unused time and charges the difference. It deliberately does NOT
 * create a second checkout: two subscriptions for one customer means two
 * charges and a mirror that only tracks the latest webhook.
 *
 * Guarded like every billing route (session identity, billing configured,
 * subscription row exists); additionally validated against Polar's live
 * subscription state — you can't switch a canceled/revoked subscription
 * (reactivate first, or wait for the period to lapse and resubscribe).
 */
export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await ctx.request.json().catch(() => ({}));
  const interval = (body as { interval?: string }).interval === "yearly" ? "yearly" : "monthly";

  if (!billingConfigured()) {
    return Response.json(
      { error: "Billing is not configured" },
      {
        status: 503,
      },
    );
  }

  const sub = await query(
    `SELECT polar_subscription_id FROM registry_subscriptions WHERE user_id = $1`,
    [userId],
  );
  const subscriptionId = (sub.rows[0] as { polar_subscription_id?: string } | undefined)
    ?.polar_subscription_id;
  if (!subscriptionId) {
    return Response.json({ error: "No subscription found for this account" }, { status: 404 });
  }

  const [target, current] = await Promise.all([
    getPolarProductIds(),
    getSubscription(subscriptionId),
  ]);
  const targetProductId = interval === "yearly" ? target.yearly : target.monthly;
  if (!targetProductId) {
    return Response.json({ error: "That plan is not available" }, { status: 404 });
  }
  if (!current) {
    return Response.json({ error: "Subscription lookup failed" }, { status: 502 });
  }
  if (
    current.status === "canceled" ||
    current.status === "revoked" ||
    current.status === "incomplete_expired" ||
    current.status === "unpaid"
  ) {
    return Response.json({ error: "Subscription is no longer switchable" }, { status: 409 });
  }
  if (current.productId === targetProductId) {
    // Already on the target plan — nothing to charge, nothing to do.
    return Response.json({ ok: true, unchanged: true });
  }

  const updated = await switchSubscriptionProduct(subscriptionId, targetProductId);
  if (!updated) {
    return Response.json({ error: "Polar rejected the plan change" }, { status: 502 });
  }

  // Mirror the new period end so the UI is right before the webhook lands;
  // the webhook's upsert stays authoritative for everything else.
  await query(
    `UPDATE registry_subscriptions
     SET current_period_end = $2, updated_at = now()
     WHERE user_id = $1`,
    [userId, updated.currentPeriodEnd],
  );

  return Response.json({ ok: true, unchanged: false });
};
