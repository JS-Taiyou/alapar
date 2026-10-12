/**
 * Tests for the cancel-at-period-end route (user-scoped: the subscription is
 * per-user): guard matrix (auth, missing subscription, unconfigured billing)
 * and the happy path with the Polar API call stubbed via globalThis.fetch,
 * asserting the mirror UPDATE.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it, vi } from "@test/compat";
import * as handler from "./cancel";
import { jsonRequest, makeCtx } from "@test/helpers";
import { __queryLog, __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/billing/cancel";

function userCtx(req: Request) {
  return makeCtx({
    req,
    locals: { user: { id: "u1" } as never },
  });
}

beforeEach(() => {
  __resetDbStub();
  vi.stubEnv("POLAR_ACCESS_TOKEN", undefined);
  vi.stubEnv("POLAR_CHECKOUT_LINK", undefined);
});

describe("billing cancel POST — guards", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, {}),
      locals: { user: null },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns 503 when billing is not configured", async () => {
    const ctx = userCtx(jsonRequest(URL, {}));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 503);
  });

  it("returns 404 when the user has no subscription row", async () => {
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_oat_test");
    vi.stubEnv("POLAR_CHECKOUT_LINK", "https://polar.sh/c/test");
    __setQueryResult({ rows: [] });
    const ctx = userCtx(jsonRequest(URL, {}));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 404);
  });
});

describe("billing cancel POST — happy path (fetch stubbed)", () => {
  beforeEach(() => {
    vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_oat_test");
    vi.stubEnv("POLAR_CHECKOUT_LINK", "https://polar.sh/c/test");
  });

  function stubFetch(ok: boolean) {
    const original = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(ok ? "{}" : "err", {
          status: ok ? 200 : 500,
        }),
      )) as typeof globalThis.fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("schedules the cancel, updates the mirror, returns activeUntil", async () => {
    const restore = stubFetch(true);
    try {
      __setQueryResult({
        rows: [
          {
            polar_subscription_id: "sub-1",
            current_period_end: "2026-09-01T00:00:00Z",
          },
        ],
      });
      const ctx = userCtx(jsonRequest(URL, {}));
      const res = await handler.POST!(ctx as never);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.activeUntil, "2026-09-01T00:00:00Z");

      const lookup = __queryLog.find((c) =>
        c.text.includes("FROM registry_subscriptions WHERE user_id"),
      );
      assertEquals(lookup!.params, ["u1"]);
      const mirrorUpdate = __queryLog.find(
        (c) =>
          c.text.includes("UPDATE registry_subscriptions") &&
          c.text.includes("cancel_at_period_end"),
      );
      assertEquals(!!mirrorUpdate, true);
      assertEquals(mirrorUpdate!.params, ["u1", true]);
    } finally {
      restore();
    }
  });

  it("undo=true reactivates and writes cancel_at_period_end = false", async () => {
    const restore = stubFetch(true);
    try {
      __setQueryResult({
        rows: [
          {
            polar_subscription_id: "sub-1",
            current_period_end: "2026-09-01T00:00:00Z",
          },
        ],
      });
      const ctx = userCtx(jsonRequest(URL, { undo: true }));
      const res = await handler.POST!(ctx as never);
      assertEquals(res.status, 200);
      const mirrorUpdate = __queryLog.filter(
        (c) =>
          c.text.includes("UPDATE registry_subscriptions") &&
          c.text.includes("cancel_at_period_end"),
      );
      assertEquals(mirrorUpdate[mirrorUpdate.length - 1].params, ["u1", false]);
    } finally {
      restore();
    }
  });

  it("returns 502 when Polar rejects the PATCH and does NOT touch the mirror", async () => {
    const restore = stubFetch(false);
    try {
      __setQueryResult({
        rows: [{ polar_subscription_id: "sub-1", current_period_end: null }],
      });
      const ctx = userCtx(jsonRequest(URL, {}));
      const res = await handler.POST!(ctx as never);
      assertEquals(res.status, 502);
      assertEquals(
        __queryLog.some(
          (c) =>
            c.text.includes("UPDATE registry_subscriptions") &&
            c.text.includes("cancel_at_period_end"),
        ),
        false,
      );
    } finally {
      restore();
    }
  });
});
