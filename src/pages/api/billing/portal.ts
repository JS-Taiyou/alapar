import type { APIRoute } from "astro";
import { createPortalSession } from "@/lib/billing";

/**
 * POST /api/billing/portal — returns a hosted Polar customer portal URL
 * (cancel / update payment method self-service) for the CURRENT user's
 * subscription.
 *
 * No body needed: the subscription is per-user, and the identity comes from
 * the session — the client cannot ask for someone else's portal.
 *
 * 404 when the user has no subscription row / Polar customer id yet
 * (nothing to manage — e.g. the "manage" action reached a free account).
 */
export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = await createPortalSession(userId);
  if (!url) {
    return Response.json({ error: "No subscription found for this account" }, { status: 404 });
  }
  return Response.json({ url });
};
