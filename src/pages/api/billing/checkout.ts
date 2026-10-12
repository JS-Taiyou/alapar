import type { APIRoute } from "astro";
import { query } from "@/lib/db";
import { resolveEffectivePlan } from "@/lib/entitlements";
import { billingConfigured, getCheckoutUrl } from "@/lib/billing";

/**
 * GET /api/billing/checkout?interval=monthly|yearly
 *
 * 302 to the dashboard-configured Polar Checkout Link, for the CURRENT user.
 * A subscription is per-user: one purchase unlocks Pro on every registry the
 * subscriber owns (joining groups stays free, as always).
 *
 * Why GET (not POST): this is a pure redirect — no state changes on our side
 * — which is exactly what GET semantics describe. Browsers can't be sent to a
 * POST target via location.href, and the pricing page navigates with plain
 * links, so GET keeps the flow simple. The worst a forged GET can do is
 * bounce someone to a Polar checkout page; the subscribing identity is the
 * session's user, resolved server-side (never from the query string).
 *
 * ALREADY-SUBSCRIBED GUARD: a user with a live subscription (per the same
 * matrix that gates registries — active/trialing, paid-through, or grace) is
 * bounced back to /pricing with a notice instead of reaching Polar. Without
 * this, a stale tab or a hand-typed URL could buy a SECOND subscription for
 * the same customer: two charges, and our per-user mirror would only track
 * whichever webhook landed last. Upgrades are a plan SWITCH on the existing
 * subscription (/api/billing/switch), never a second checkout.
 *
 * 503 when billing env vars are unset: surfacing misconfiguration beats a
 * broken redirect to a URL we can't build.
 */
export const GET: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const interval = ctx.url.searchParams.get("interval") === "yearly"
    ? "yearly"
    : "monthly";

  if (!billingConfigured()) {
    return Response.json(
      { error: "Billing is not configured" },
      { status: 503 },
    );
  }

  const sub = await query(
    `SELECT status, grace_until, current_period_end
     FROM registry_subscriptions WHERE user_id = $1`,
    [userId],
  );
  const row = sub.rows[0] as
    | {
      status: string;
      grace_until: string | null;
      current_period_end: string | null;
    }
    | undefined;
  if (
    row &&
    resolveEffectivePlan(
        "free",
        row.status,
        row.grace_until ? new Date(row.grace_until) : null,
        row.current_period_end ? new Date(row.current_period_end) : null,
      ) !== "free"
  ) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/pricing?already_subscribed=1" },
    });
  }

  const checkoutUrl = getCheckoutUrl(
    userId,
    interval,
    ctx.locals.locale,
  );
  return new Response(null, {
    status: 302,
    headers: { Location: checkoutUrl },
  });
};
