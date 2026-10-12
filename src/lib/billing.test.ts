/**
 * Tests for the Polar webhook verifier + event→DB upsert (lib/billing.ts).
 *
 * The verifier uses real HMAC-SHA256 via WebCrypto, so the test signs
 * payloads the same way Polar does (Standard Webhooks spec) and checks
 * valid / tampered / stale / missing-signature cases.
 */
import { assert, assertEquals } from "@test/compat";
import { beforeEach, describe, it, vi } from "@test/compat";
import { handleSubscriptionEvent, verifyWebhook } from "./billing";
import { __queryLog, __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

// Deterministic test secret (base64 of 32 bytes).
const SECRET_B64 = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=";
const SECRET = `polar_whsec_${SECRET_B64}`;

async function sign(
  payload: string,
  timestamp: number = Math.floor(Date.now() / 1000),
  msgId: string = "msg_test_123",
): Promise<Headers> {
  const keyBytes = Uint8Array.from(atob(SECRET_B64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${msgId}.${timestamp}.${payload}`),
  );
  let bin = "";
  for (const b of new Uint8Array(mac)) bin += String.fromCharCode(b);
  const sig = btoa(bin);
  return new Headers({
    "webhook-id": msgId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${sig}`,
  });
}

function makeReq(payload: string, headers: Headers): Request {
  return new Request("https://test.local/api/webhooks/polar", {
    method: "POST",
    headers,
    body: payload,
  });
}

beforeEach(() => {
  vi.stubEnv("POLAR_WEBHOOK_SECRET", SECRET);
  __resetDbStub();
});

// ---------------------------------------------------------------------------
// verifyWebhook
// ---------------------------------------------------------------------------

describe("verifyWebhook", () => {
  it("accepts a correctly signed, fresh payload", async () => {
    const payload = JSON.stringify({ type: "subscription.active", data: {} });
    const headers = await sign(payload);
    const result = await verifyWebhook(makeReq(payload, headers));
    assertEquals(result.valid, true);
    assertEquals(result.payload!.type, "subscription.active");
  });

  it("rejects a tampered body", async () => {
    const headers = await sign(JSON.stringify({ a: 1 }));
    const result = await verifyWebhook(makeReq(JSON.stringify({ a: 2 }), headers));
    assertEquals(result.valid, false);
  });

  it("rejects a bad signature value", async () => {
    const payload = "{}";
    const headers = await sign(payload);
    headers.set("webhook-signature", "v1,AAAAbbbbCCCCdddd==");
    assertEquals((await verifyWebhook(makeReq(payload, headers))).valid, false);
  });

  it("rejects a stale timestamp (replay)", async () => {
    const payload = "{}";
    const stale = Math.floor(Date.now() / 1000) - 3600; // 1h old
    const headers = await sign(payload, stale);
    assertEquals((await verifyWebhook(makeReq(payload, headers))).valid, false);
  });

  it("rejects when signature headers are missing", async () => {
    const result = await verifyWebhook(
      makeReq("{}", new Headers({ "content-type": "application/json" })),
    );
    assertEquals(result.valid, false);
  });

  it("rejects when no secret is configured", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", undefined as unknown as string);
    const payload = "{}";
    const headers = await sign(payload);
    assertEquals((await verifyWebhook(makeReq(payload, headers))).valid, false);
  });

  it("accepts multi-scheme signature headers with any v1 match", async () => {
    const payload = "{}";
    const headers = await sign(payload);
    const good = headers.get("webhook-signature")!;
    headers.set("webhook-signature", `v1,badbadbad== ${good}`);
    assertEquals((await verifyWebhook(makeReq(payload, headers))).valid, true);
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionEvent — DB upsert mapping
// ---------------------------------------------------------------------------

describe("handleSubscriptionEvent", () => {
  const activeEvent = {
    type: "subscription.active",
    data: {
      id: "sub_123",
      status: "active",
      customer: { id: "cust_1" },
      current_period_end: "2026-09-01T00:00:00Z",
      metadata: { user_id: "user-1" },
    },
  };

  it("upserts the subscription row with mapped fields", async () => {
    await handleSubscriptionEvent(activeEvent);
    const insert = __queryLog.find((c) => c.text.includes("INSERT INTO registry_subscriptions"));
    assert(insert, "expected an upsert query");
    assertEquals(insert!.params[0], "user-1"); // user_id (PK — per-user sub)
    assertEquals(insert!.params[1], "sub_123"); // polar_subscription_id
    assertEquals(insert!.params[2], "cust_1"); // polar_customer_id
    assertEquals(insert!.params[3], "active"); // status
    assertEquals(insert!.params[4], "2026-09-01T00:00:00Z");
    assertEquals(insert!.params[5], null); // no grace on active
    assertEquals(insert!.params[6], false); // cancel_at_period_end absent
  });

  it("persists cancel_at_period_end from the event", async () => {
    await handleSubscriptionEvent({
      type: "subscription.updated",
      data: { ...activeEvent.data, cancel_at_period_end: true },
    });
    const upsert = __queryLog.find((c) => c.text.includes("INSERT INTO registry_subscriptions"));
    assertEquals(upsert!.params[6], true);
  });

  it("flips plan to pro on EVERY group the subscriber belongs to", async () => {
    await handleSubscriptionEvent(activeEvent);
    const flip = __queryLog.find((c) => c.text.includes("SET plan = 'pro'"));
    assert(flip, "expected plan flip to pro");
    // Member-based: any membership counts (a subscribed member carries
    // their whole group) — the flip must NOT be role-scoped.
    assertEquals(flip!.params[0], "user-1");
    assertEquals(flip!.text.includes("rm.role"), false);
  });

  it("past_due ALSO sets the grace window (one failed charge ≠ instant cut)", async () => {
    await handleSubscriptionEvent({
      type: "subscription.updated",
      data: { ...activeEvent.data, status: "past_due" },
    });
    const upsert = __queryLog.find((c) => c.text.includes("INSERT INTO registry_subscriptions"));
    assert(upsert!.params[5], "past_due events must set grace_until");
  });

  it("falls back to top-level reference_id when metadata is empty", async () => {
    // Polar's documented checkout-link params include reference_id but NOT
    // metadata[…] — if metadata is dropped, the mapping must still work.
    const { metadata: _drop, ...dataNoMeta } = activeEvent.data;
    await handleSubscriptionEvent({
      type: "subscription.active",
      data: { ...dataNoMeta, reference_id: "user-via-ref" },
    });
    const upsert = __queryLog.find((c) => c.text.includes("INSERT INTO registry_subscriptions"));
    assert(upsert, "expected an upsert via reference_id fallback");
    assertEquals(upsert!.params[0], "user-via-ref");
  });

  it("canceled sets a 3-day grace window instead of cutting immediately", async () => {
    await handleSubscriptionEvent({
      type: "subscription.canceled",
      data: { ...activeEvent.data, status: "canceled" },
    });
    const upsert = __queryLog.find((c) => c.text.includes("INSERT INTO registry_subscriptions"));
    const grace = upsert!.params[5] as string;
    assert(grace, "canceled events must set grace_until");
    const graceMs = new Date(grace).getTime();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    assert(
      Math.abs(graceMs - Date.now() - threeDays) < 60_000,
      `grace_until should be ~3 days out, got ${grace}`,
    );
  });

  it("ignores events without registry metadata (not ours)", async () => {
    await handleSubscriptionEvent({
      type: "subscription.active",
      data: { id: "sub_x", status: "active", metadata: {} },
    });
    assertEquals(
      __queryLog.some((c) => c.text.includes("registry_subscriptions")),
      false,
    );
  });
});
