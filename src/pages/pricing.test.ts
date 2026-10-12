/**
 * Session-state matrix tests for the public pricing page (per-user
 * subscription model): anonymous, owned-free, live/cancel-scheduled
 * subscription, grandfathered, none. In the Fresh app these ran against the
 * page's GET handler; in Astro that logic lives in `src/lib/pricing.ts`
 * (extracted from pricing.astro frontmatter, which isn't unit-callable).
 *
 * Prices fall back to constants (no Polar token in tests); queries run
 * against the db stub, differentiated by SQL text (memberships vs
 * subscription lookup).
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it, vi } from "@test/compat";
import { getPrices, getPricingSessionState } from "@/lib/pricing";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

beforeEach(() => {
  __resetDbStub();
  vi.stubEnv("POLAR_ACCESS_TOKEN", undefined as unknown as string);
});

function stubFor(memberships: Record<string, unknown>[], sub: Record<string, unknown> | undefined) {
  __setQueryResult((text) => {
    if (text.includes("FROM registry_subscriptions WHERE user_id")) {
      return { rows: sub ? [sub] : [] };
    }
    return { rows: memberships };
  });
}

const SUB_ACTIVE = {
  status: "active",
  grace_until: null,
  current_period_end: "2026-09-01T00:00:00Z",
  cancel_at_period_end: false,
};

// Dates relative to "now" so paid-through assertions can't rot: a hardcoded
// future date eventually slips into the past and flips the entitlement
// matrix (this exact failure shipped 2026-10-09, two months after 09-01).
const isoFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const PAST = "2026-01-01T00:00:00Z";

describe("pricing — anonymous", () => {
  it("returns fallback prices and no session state", async () => {
    const prices = await getPrices();
    assertEquals(prices.monthly, 1.99);
    assertEquals(prices.yearly, 15);
    const state = await getPricingSessionState(null);
    assertEquals(state.userSub, null);
    assertEquals(state.freeGroupsCount, 0);
    assertEquals(state.hasNoRegistries, false);
  });
});

describe("pricing — authenticated (per-user model)", () => {
  it("counts effectively-free groups as upgrade candidates (owner or member)", async () => {
    stubFor(
      [
        { role: "owner", plan: "free" },
        { role: "owner", plan: "free" },
        { role: "member", plan: "pro" },
      ],
      undefined,
    );
    const state = await getPricingSessionState("u1");
    assertEquals(state.freeGroupsCount, 2);
    assertEquals(state.userSub, null);
  });

  it("a free group the user merely BELONGS to is an upgrade candidate", async () => {
    stubFor([{ role: "member", plan: "free" }], undefined);
    const state = await getPricingSessionState("u1");
    assertEquals(state.freeGroupsCount, 1);
  });

  it("a free group kept Pro by ANOTHER member is not a candidate", async () => {
    stubFor(
      [
        { role: "member", plan: "free", member_pro: true },
        { role: "owner", plan: "free" },
      ],
      undefined,
    );
    const state = await getPricingSessionState("u1");
    assertEquals(state.freeGroupsCount, 1);
  });

  it("a live subscription unlocks everything: no candidates, Active state", async () => {
    stubFor(
      [
        { role: "owner", plan: "free" },
        { role: "owner", plan: "free" },
      ],
      SUB_ACTIVE,
    );
    const state = await getPricingSessionState("u1");
    assertEquals(state.freeGroupsCount, 0);
    assertEquals(state.userSub?.currentPeriodEnd, "2026-09-01T00:00:00Z");
    assertEquals(state.userSub?.cancelScheduled, false);
  });

  it("carries the cancel-scheduled flag", async () => {
    stubFor([{ role: "owner", plan: "pro" }], {
      ...SUB_ACTIVE,
      cancel_at_period_end: true,
    });
    const state = await getPricingSessionState("u1");
    assertEquals(state.userSub?.cancelScheduled, true);
  });

  it("a dead subscription (beyond grace and paid-through) is not Active", async () => {
    stubFor([{ role: "owner", plan: "free" }], {
      status: "canceled",
      grace_until: PAST,
      current_period_end: PAST,
      cancel_at_period_end: false,
    });
    const state = await getPricingSessionState("u1");
    assertEquals(state.userSub, null);
    assertEquals(state.freeGroupsCount, 1);
  });

  it("canceled-but-paid-through counts as live (rest of the cycle)", async () => {
    stubFor([{ role: "owner", plan: "free" }], {
      status: "canceled",
      grace_until: PAST,
      current_period_end: isoFromNow(10),
      cancel_at_period_end: false,
    });
    const state = await getPricingSessionState("u1");
    assertEquals(state.userSub !== null, true);
    assertEquals(state.freeGroupsCount, 0);
  });

  it("flags grandfathered ownership", async () => {
    stubFor(
      [
        { role: "owner", plan: "grandfathered" },
        { role: "owner", plan: "free" },
      ],
      undefined,
    );
    const state = await getPricingSessionState("u1");
    assertEquals(state.hasGrandfatheredOwned, true);
    assertEquals(state.freeGroupsCount, 1);
  });

  it("marks a brand-new user with no registries", async () => {
    stubFor([], undefined);
    const state = await getPricingSessionState("u1");
    assertEquals(state.hasNoRegistries, true);
  });
});
