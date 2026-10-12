/**
 * Tests for lib/entitlements.ts against the db stub.
 *
 * Covers: plan resolution (free / pro column / grandfathered / subscription
 * states incl. past_due grace), limit sets, and the count helpers.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import {
  countActiveTemplates,
  countOwnedRegistries,
  countRegistryMembers,
  entitlementsFor,
  FREE_LIMITS,
  getRegistryPlan,
  UNLIMITED,
} from "./entitlements";
import { __queryLog, __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

beforeEach(() => __resetDbStub());

// ---------------------------------------------------------------------------
// entitlementsFor — pure limit mapping
// ---------------------------------------------------------------------------

describe("entitlementsFor", () => {
  it("free → FREE_LIMITS", () => {
    assertEquals(entitlementsFor("free"), FREE_LIMITS);
    assertEquals(FREE_LIMITS.maxOwnedRegistries, 2);
    assertEquals(FREE_LIMITS.maxMembers, 2);
    assertEquals(FREE_LIMITS.maxActiveTemplates, 3);
    assertEquals(FREE_LIMITS.maxClosedExercisesVisible, 1);
  });

  it("pro → unlimited", () => {
    assertEquals(entitlementsFor("pro"), UNLIMITED);
    assertEquals(UNLIMITED.maxMembers, Infinity);
  });

  it("grandfathered → unlimited", () => {
    assertEquals(entitlementsFor("grandfathered"), UNLIMITED);
  });
});

// ---------------------------------------------------------------------------
// getRegistryPlan — the resolution matrix
// ---------------------------------------------------------------------------

describe("getRegistryPlan", () => {
  it("returns null when the registry doesn't exist", async () => {
    __setQueryResult({ rows: [] });
    assertEquals(await getRegistryPlan("r-missing"), null);
  });

  it("free plan with no subscription → free limits", async () => {
    __setQueryResult({
      rows: [{ plan: "free", sub_status: null, grace_until: null }],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info!.plan, "free");
    assertEquals(info!.isPro, false);
    assertEquals(info!.limits, FREE_LIMITS);
  });

  it("pro column + canceled with NO grace → DEMOTES to free (revenue fix)", async () => {
    // The webhook never writes plan='free' on cancel; this read is where
    // cancellation takes effect. A 'pro' column with a dead subscription
    // must not stay Pro forever.
    __setQueryResult({
      rows: [{ plan: "pro", sub_status: "canceled", grace_until: null }],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info!.isPro, false);
    assertEquals(info!.plan, "free");
  });

  it("pro column + canceled beyond grace → free", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [{ plan: "pro", sub_status: "canceled", grace_until: past }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, false);
  });

  it("canceled but paid-through (current_period_end in the future) → pro", async () => {
    // Polar's cancel_at_period_end: the user paid for the period, so Pro
    // lasts until current_period_end even if a canceled event lands early.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [
        {
          plan: "pro",
          sub_status: "canceled",
          grace_until: past,
          current_period_end: future,
        },
      ],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info?.isPro, true);
  });

  it("canceled with current_period_end in the past → free (beyond grace)", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [
        {
          plan: "pro",
          sub_status: "canceled",
          grace_until: past,
          current_period_end: past,
        },
      ],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info?.isPro, false);
  });

  it("revoked but paid-through does NOT use paid-through (immediate end)", async () => {
    // Paid-through applies to canceled only; revoked is an immediate stop.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [
        {
          plan: "pro",
          sub_status: "revoked",
          grace_until: past,
          current_period_end: future,
        },
      ],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info?.isPro, false);
  });

  it("pro column + canceled WITHIN grace → still pro", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [{ plan: "pro", sub_status: "canceled", grace_until: future }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  it("pro column + revoked beyond grace → free", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [{ plan: "pro", sub_status: "revoked", grace_until: past }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, false);
  });

  it("pro column + active subscription → pro", async () => {
    __setQueryResult({
      rows: [{ plan: "pro", sub_status: "active", grace_until: null }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  it("pro column + NO subscription row → pro (nothing contradicts it)", async () => {
    __setQueryResult({
      rows: [{ plan: "pro", sub_status: null, grace_until: null }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  it("grandfathered column → unlimited", async () => {
    __setQueryResult({
      rows: [{ plan: "grandfathered", sub_status: null, grace_until: null }],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info!.isPro, true);
    assertEquals(info!.plan, "grandfathered");
  });

  it("grandfathered column stays unlimited even with a dead subscription", async () => {
    // Grandfathering is permanent by design — a subscription (e.g. an owner
    // who upgraded anyway, then canceled) can never demote it.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [{ plan: "grandfathered", sub_status: "canceled", grace_until: past }],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info!.isPro, true);
    assertEquals(info!.plan, "grandfathered");
  });

  it("free column + active subscription → effective pro (webhook-lag cover)", async () => {
    __setQueryResult({
      rows: [{ plan: "free", sub_status: "active", grace_until: null }],
    });
    const info = await getRegistryPlan("r1");
    assertEquals(info!.isPro, true);
  });

  it("free column + trialing subscription → effective pro", async () => {
    __setQueryResult({
      rows: [{ plan: "free", sub_status: "trialing", grace_until: null }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  it("past_due within grace → still pro", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [{ plan: "free", sub_status: "past_due", grace_until: future }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  it("past_due after grace → back to free", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [{ plan: "free", sub_status: "past_due", grace_until: past }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, false);
  });

  it("canceled subscription outside grace → free", async () => {
    __setQueryResult({
      rows: [{ plan: "free", sub_status: "canceled", grace_until: null }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, false);
  });

  it("free column + canceled WITHIN grace → pro (grace covers un-flipped column)", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [{ plan: "free", sub_status: "canceled", grace_until: future }],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  // Multi-member rows: one row per member, each with their own subscription
  // state — any live member keeps the whole group Pro.
  it("member-based: owner's dead sub + another member active → pro", async () => {
    __setQueryResult({
      rows: [
        { plan: "pro", sub_status: "canceled", grace_until: null },
        { plan: "pro", sub_status: "active", grace_until: null },
      ],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  it("member-based: all members' subs dead → free (last Pro member lapsed)", async () => {
    __setQueryResult({
      rows: [
        { plan: "pro", sub_status: "canceled", grace_until: null },
        { plan: "pro", sub_status: "revoked", grace_until: null },
      ],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, false);
  });

  it("member-based: one member paid-through keeps the group Pro", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    __setQueryResult({
      rows: [
        { plan: "free", sub_status: null },
        {
          plan: "free",
          sub_status: "canceled",
          grace_until: past,
          current_period_end: future,
        },
      ],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });

  it("member-based: no member ever subscribed + pro column → pro (no contradiction)", async () => {
    __setQueryResult({
      rows: [
        { plan: "pro", sub_status: null },
        { plan: "pro", sub_status: null },
      ],
    });
    assertEquals((await getRegistryPlan("r1"))!.isPro, true);
  });
});

// ---------------------------------------------------------------------------
// Count helpers — SQL shape verification via the query log
// ---------------------------------------------------------------------------

describe("count helpers", () => {
  it("countOwnedRegistries counts only owner rows on effectively-FREE registries", async () => {
    // Pro/grandfathered owned groups must NOT consume the create cap —
    // otherwise every post-migration user with 2 grandfathered registries
    // (i.e. all early users) would be locked out of creating any new group.
    __setQueryResult({ rows: [{ cnt: 2 }] });
    assertEquals(await countOwnedRegistries("u1"), 2);
    const sql = __queryLog[0].text;
    assertEquals(sql.includes("role = 'owner'"), true);
    assertEquals(sql.includes("r.plan = 'free'"), true); // the cap fix
  });

  it("countRegistryMembers counts membership rows", async () => {
    __setQueryResult({ rows: [{ cnt: 4 }] });
    assertEquals(await countRegistryMembers("r1"), 4);
  });

  it("countActiveTemplates counts distinct groups, excludes paid-off and disabled", async () => {
    __setQueryResult({ rows: [{ cnt: 3 }] });
    assertEquals(await countActiveTemplates("r1"), 3);
    const sql = __queryLog[0].text;
    assertEquals(sql.includes("recurring_disabled = false"), true);
    assertEquals(sql.includes("installment_current < installment_total"), true);
  });
});
