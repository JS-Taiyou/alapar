import type { APIRoute } from "astro";
import {
  handleSubscriptionEvent,
  verifyWebhook,
} from "@/lib/billing";

/**
 * POST /api/webhooks/polar — Polar subscription lifecycle events.
 *
 * PUBLIC endpoint: outside the auth-guarded path list and CSRF-exempt in
 * src/middleware.ts. Both are safe because authenticity comes from the
 * Standard Webhooks HMAC signature (lib/billing.ts verifyWebhook), not from
 * our session/origin — Polar's servers have no browser session and send no
 * Origin header. It is also NOT in the rate-limit list: Polar retries
 * deliveries and must not be throttled into false failures.
 *
 * STATUS-CODE SEMANTICS (the load-bearing part):
 *   401 invalid signature → Polar does NOT retry. A bad signature can never
 *                           become good by retrying (wrong secret config or
 *                           an attacker) — retrying would mask a
 *                           misconfiguration as flakiness.
 *   500 handler error     → Polar RETRIES with backoff. A transient DB blip
 *                           must not lose a paid activation, so failures
 *                           INSIDE handleSubscriptionEvent surface as 500.
 *   200                   → acknowledged. The handler is idempotent:
 *                           at-least-once redelivery just re-upserts the same
 *                           row (keyed on registry_id).
 *
 * Event routing: we act on `subscription.*` only; other event types
 * (product/customer/…) are acknowledged and ignored, so Polar doesn't retry
 * forever on events we never opted into.
 */
export const POST: APIRoute = async (ctx) => {
  const { valid, reason, payload } = await verifyWebhook(ctx.request);
  if (!valid || !payload) {
    // Polar's dashboard only shows "401"; this line is what tells YOU
    // whether it's a secret mismatch, an unset env var, or a replay.
    console.warn(`[billing] webhook rejected: ${reason ?? "unknown"}`);
    return new Response("invalid signature", { status: 401 });
  }

  const type = payload.type as string | undefined;
  if (typeof type === "string" && type.startsWith("subscription.")) {
    try {
      await handleSubscriptionEvent(payload);
    } catch (err) {
      console.error("[billing] webhook handler failed:", err);
      return new Response("handler error", { status: 500 });
    }
  }

  // Ack everything else (product/customer events we don't act on).
  return Response.json({ received: true });
};
