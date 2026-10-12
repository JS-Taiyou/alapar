import { query } from "@/lib/db";
import { resolveEffectivePlan, SUB_LIVE_SQL } from "@/lib/entitlements";
import {
  FALLBACK_PRICES,
  getPolarPrices,
  getPolarProductIds,
  getSubscription,
} from "@/lib/billing";

/**
 * Session-state matrix for the public pricing page, extracted from
 * `src/pages/pricing.astro` so the entitlement decisions stay unit-testable
 * (in the Fresh app this lived in the page's GET handler, which was directly
 * callable; Astro frontmatter is not).
 */

export interface UserSubState {
  currentPeriodEnd: string | null;
  cancelScheduled: boolean;
  /** Which interval the live subscription is on (null = unknown/offline). */
  interval: "monthly" | "yearly" | null;
}

export interface PricingSessionState {
  userSub: UserSubState | null;
  freeGroupsCount: number;
  hasGrandfatheredOwned: boolean;
  hasNoRegistries: boolean;
}

/** Prices with the offline fallback applied when Polar isn't configured. */
export async function getPrices(): Promise<{
  monthly: number;
  yearly: number;
}> {
  const polar = await getPolarPrices();
  return {
    monthly: polar.monthly ?? FALLBACK_PRICES.monthly,
    yearly: polar.yearly ?? FALLBACK_PRICES.yearly,
  };
}

export async function getPricingSessionState(userId: string | null): Promise<PricingSessionState> {
  const state: PricingSessionState = {
    userSub: null,
    freeGroupsCount: 0,
    hasGrandfatheredOwned: false,
    hasNoRegistries: false,
  };
  if (!userId) return state;

  const [memberships, sub] = await Promise.all([
    query(
      `SELECT rm.role, r.plan,
              EXISTS (
                SELECT 1 FROM registry_members rm2
                JOIN registry_subscriptions rs ON rs.user_id = rm2.user_id
                WHERE rm2.registry_id = r.id AND (${SUB_LIVE_SQL})
              ) AS member_pro
       FROM registry_members rm
       JOIN registries r ON r.id = rm.registry_id
       WHERE rm.user_id = $1`,
      [userId],
    ),
    query(
      `SELECT polar_subscription_id, status, grace_until, current_period_end, cancel_at_period_end
       FROM registry_subscriptions WHERE user_id = $1`,
      [userId],
    ),
  ]);

  state.hasNoRegistries = memberships.rows.length === 0;

  // The user's subscription is "live" when the same matrix that gates
  // registries says so — one check, shared semantics.
  let subLive = false;
  const subRow = sub.rows[0] as
    | {
        polar_subscription_id?: string;
        status: string;
        grace_until: string | null;
        current_period_end: string | null;
        cancel_at_period_end: boolean;
      }
    | undefined;
  if (subRow) {
    subLive =
      resolveEffectivePlan(
        "free",
        subRow.status,
        subRow.grace_until ? new Date(subRow.grace_until) : null,
        subRow.current_period_end ? new Date(subRow.current_period_end) : null,
      ) !== "free";
    if (subLive) {
      state.userSub = {
        currentPeriodEnd: subRow.current_period_end,
        cancelScheduled: subRow.cancel_at_period_end === true,
        interval: null,
      };
      // Which plan the subscriber is on (for the switch button label).
      // One extra Polar read per subscriber view; silent-null on failure
      // simply hides the switch button.
      if (subRow.polar_subscription_id) {
        const [productIds, currentSub] = await Promise.all([
          getPolarProductIds(),
          getSubscription(subRow.polar_subscription_id),
        ]);
        if (currentSub?.productId) {
          state.userSub.interval =
            currentSub.productId === productIds.yearly
              ? "yearly"
              : currentSub.productId === productIds.monthly
                ? "monthly"
                : null;
        }
      }
    }
  }

  for (const row of memberships.rows) {
    if (row.plan === "grandfathered") {
      // Founding-member note only for OWNERS of a grandfathered group —
      // a mere member of one isn't "founding".
      if (row.role === "owner") state.hasGrandfatheredOwned = true;
      continue;
    }
    // Upgrade candidates: effectively-free groups the user is in — not
    // grandfathered, not Pro via any member (including this user when
    // subLive, which the !subLive guard already covers), column free.
    if (!subLive && row.plan === "free" && row.member_pro !== true) {
      state.freeGroupsCount++;
    }
  }

  return state;
}
