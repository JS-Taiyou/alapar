/**
 * Plan entitlements — what a registry can do on 'free' vs 'pro'.
 *
 * The paid unit is the USER: any member with an active subscription makes
 * the whole group Pro (a subscriber in 3 groups unlocks all 3). Joining
 * groups is never gated; a group keeps Pro until its last Pro member leaves
 * or their subscription lapses.
 *
 * Plan resolution order (per registry):
 *   1. registries.plan = 'grandfathered' → unlimited (permanent)
 *   2. ANY member's subscription live (trialing/active, paid-through,
 *      or within grace) → unlimited
 *   3. otherwise → free limits
 *
 * All limits are enforced server-side at the mutation/API boundary; the UI
 * reads the same values from ctx.state to render CTAs.
 */

import { query } from "./db";

/**
 * SQL predicate (expects the registry_subscriptions row aliased `rs`): true
 * when that subscription is live per the matrix — trialing/active, canceled
 * but paid-through, or inside its dunning/cancel grace window. Shared by
 * every query that needs per-user Pro status in SQL (USER_PRO_SQL, the
 * create cap, the pricing page) so it can't drift from resolveEffectivePlan.
 */
export const SUB_LIVE_SQL = `rs.status IN ('trialing', 'active')
  OR (rs.status = 'canceled' AND rs.current_period_end > now())
  OR (rs.status IN ('past_due', 'canceled', 'revoked') AND rs.grace_until > now())`;

/**
 * SQL column computing a USER's personal Pro status; requires the users
 * table aliased `u` in the enclosing query. Drives the crown badge:
 *   'subscribed'    → live subscription (crown links to /pricing to manage)
 *   'grandfathered' → founding member, owns a grandfathered registry (Pro
 *                     forever; the crown is inert)
 *   NULL            → not Pro
 */
export const USER_PRO_SQL = `CASE
  WHEN EXISTS (
    SELECT 1 FROM registry_subscriptions rs
    WHERE rs.user_id = u.id AND (${SUB_LIVE_SQL})
  ) THEN 'subscribed'
  WHEN EXISTS (
    SELECT 1 FROM registry_members fm
    JOIN registries fr ON fr.id = fm.registry_id
    WHERE fm.user_id = u.id AND fm.role = 'owner' AND fr.plan = 'grandfathered'
  ) THEN 'grandfathered'
END AS pro`;

export type RegistryPlan = "free" | "pro" | "grandfathered";

export interface PlanLimits {
  maxOwnedRegistries: number;
  maxMembers: number;
  maxActiveTemplates: number;
  /** How many CLOSED exercises are visible. Current (open) exercise always
   * counts separately and is always visible. */
  maxClosedExercisesVisible: number;
}

export const FREE_LIMITS: PlanLimits = {
  maxOwnedRegistries: 2,
  // TOTAL members including the owner (a couple/pair fits free).
  maxMembers: 2,
  maxActiveTemplates: 3,
  maxClosedExercisesVisible: 1,
};

export const UNLIMITED: PlanLimits = {
  maxOwnedRegistries: Infinity,
  maxMembers: Infinity,
  maxActiveTemplates: Infinity,
  maxClosedExercisesVisible: Infinity,
};

export function entitlementsFor(plan: RegistryPlan): PlanLimits {
  return plan === "free" ? FREE_LIMITS : UNLIMITED;
}

export interface RegistryPlanInfo {
  plan: RegistryPlan;
  /** True when the registry has unlimited access (pro/grandfathered). */
  isPro: boolean;
  limits: PlanLimits;
}

/**
 * Pure plan-resolution matrix, extracted so callers that already hold the DB
 * fields (getRegistryPlan, the pricing page's one-query listing) share the
 * exact same semantics. First match wins:
 *
 *   plan = 'grandfathered'                      → PRO (permanent)
 *   subscription trialing|active                → PRO
 *   subscription canceled AND paid-through
 *     (current_period_end > now)                → PRO (cancel-at-period-end
 *                                                  keeps access until the
 *                                                  period the user paid for)
 *   subscription past_due|canceled|revoked
 *     AND grace_until > now                     → PRO (dunning/cancel grace)
 *   plan = 'pro' AND no subscription row        → PRO (no contradiction)
 *   anything else                               → FREE
 *
 * The canceled-paid-through row matters because Polar's
 * cancel_at_period_end keeps the subscription alive until current_period_end;
 * if a `subscription.canceled` webhook lands while that date is still in the
 * future, the user must keep Pro for the time they paid for — the 3-day grace
 * alone would cut them off early.
 */
export function resolveEffectivePlan(
  plan: RegistryPlan,
  subStatus: string | null,
  graceUntil: Date | null,
  currentPeriodEnd: Date | null,
  now: number = Date.now(),
): RegistryPlan {
  if (plan === "grandfathered") {
    // Permanent by design — checked FIRST so no subscription state, however
    // dead, can ever demote it (the webhook's flip is WHERE plan='free').
    return "grandfathered";
  }
  const subLive = subStatus === "trialing" || subStatus === "active";
  if (subLive) {
    // A live subscription is Pro regardless of what the column says: covers
    // activation webhook lag (column still 'free').
    return "pro";
  }
  const paidThrough =
    subStatus === "canceled" && !!currentPeriodEnd && currentPeriodEnd.getTime() > now;
  if (paidThrough) return "pro";
  const inGrace =
    !!graceUntil &&
    graceUntil.getTime() > now &&
    (subStatus === "past_due" || subStatus === "canceled" || subStatus === "revoked");
  if (inGrace) return "pro";
  if (plan === "pro" && subStatus === null) {
    // Column says pro and there is no subscription row contradicting it.
    // (In practice the flip webhook always writes both; this branch is the
    // defensive no-contradiction case.)
    return "pro";
  }
  // plan='free' with no live sub → free.
  // plan='pro' with a DEAD sub (canceled/revoked/past_due beyond grace and
  // beyond paid-through) → free. This is where cancellation takes effect.
  return "free";
}

/**
 * Resolve the effective plan for a registry. Returns null when the registry
 * doesn't exist.
 *
 * One round trip: `registries.plan` plus the subscription mirror of EVERY
 * member. A subscription is per-USER: any member's live subscription makes
 * the whole group Pro (grandfathering stays per-registry via the plan
 * column). A group keeps Pro until the last Pro member is evicted or their
 * subscription lapses — demotion happens right here, on read, with no
 * background job. Semantics live in {@link resolveEffectivePlan} — the single
 * source of truth the UI reads via ctx.state.activeRegistryPlan (populated
 * with this same function on full-state paths) and enforcement must call.
 */
export async function getRegistryPlan(registryId: string): Promise<RegistryPlanInfo | null> {
  const result = await query(
    `SELECT r.plan,
            rs.status AS sub_status,
            rs.grace_until,
            rs.current_period_end
     FROM registries r
     LEFT JOIN registry_members rm ON rm.registry_id = r.id
     LEFT JOIN registry_subscriptions rs ON rs.user_id = rm.user_id
     WHERE r.id = $1`,
    [registryId],
  );
  if (result.rows.length === 0) return null;

  // One row per member, each carrying that member's subscription state
  // (nulls when they never subscribed). The registry-level plan column is
  // the same on every row.
  const registryPlan = result.rows[0].plan as RegistryPlan;
  let anyMemberPro = false;
  let anyMemberSubscribed = false;
  for (const row of result.rows) {
    const subStatus = row.sub_status as string | null;
    if (subStatus !== null) anyMemberSubscribed = true;
    // Members are resolved with plan='free': the registry's own column must
    // not leak in and make everyone Pro. The matrix's live/paid-through/grace
    // rows are exactly the per-user Pro states we want.
    if (
      resolveEffectivePlan(
        "free",
        subStatus,
        row.grace_until ? new Date(row.grace_until as string) : null,
        row.current_period_end ? new Date(row.current_period_end as string) : null,
      ) !== "free"
    ) {
      anyMemberPro = true;
      break;
    }
  }

  let effective: RegistryPlan;
  if (registryPlan === "grandfathered") {
    effective = "grandfathered";
  } else if (anyMemberPro) {
    effective = "pro";
  } else if (registryPlan === "pro" && !anyMemberSubscribed) {
    // Column says pro and NO member has a subscription row contradicting it
    // (the multi-member generalization of the defensive no-contradiction
    // branch in resolveEffectivePlan).
    effective = "pro";
  } else {
    effective = "free";
  }

  return {
    plan: effective,
    isPro: effective !== "free",
    limits: entitlementsFor(effective),
  };
}

/**
 * Count registries the user owns whose EFFECTIVE plan is free (for the
 * create cap).
 *
 * Only free registries consume the cap — grandfathered and Pro groups do NOT.
 * This matters in both directions:
 *   - Post-migration, most users own 1-2 grandfathered registries; counting
 *     those would lock long-time users out of ever creating a new group
 *     (a regression against their pre-billing "unlimited").
 *   - A paying customer must still be able to start new groups (their
 *     subscription unlocks them after creation).
 *
 * "Effectively free" mirrors getRegistryPlan: plan 'free' AND no member of
 * the group has a live subscription. A group kept Pro by ANOTHER member
 * therefore doesn't count against this owner's cap either.
 */
export async function countOwnedRegistries(userId: string): Promise<number> {
  const result = await query(
    `SELECT count(*)::int AS cnt
     FROM registry_members rm
     JOIN registries r ON r.id = rm.registry_id
     WHERE rm.user_id = $1
       AND rm.role = 'owner'
       AND r.plan = 'free'
       AND NOT EXISTS (
         SELECT 1 FROM registry_members rm2
         JOIN registry_subscriptions rs ON rs.user_id = rm2.user_id
         WHERE rm2.registry_id = r.id AND (${SUB_LIVE_SQL})
       )`,
    [userId],
  );
  return result.rows[0].cnt as number;
}

/** Count members of a registry (for the join cap). */
export async function countRegistryMembers(registryId: string): Promise<number> {
  const result = await query(
    `SELECT count(*)::int AS cnt FROM registry_members WHERE registry_id = $1`,
    [registryId],
  );
  return result.rows[0].cnt as number;
}

/**
 * Count active recurring/installment templates for a registry — mirrors the
 * spawn-candidate eligibility rules (recurring not disabled; parcialidad not
 * fully paid), regardless of archived state since clones reset exercise_id.
 */
export async function countActiveTemplates(registryId: string): Promise<number> {
  const result = await query(
    `SELECT count(DISTINCT recurring_group_id)::int AS cnt
     FROM transactions
     WHERE registry_id = $1
       AND recurring_disabled = false
       AND type IN ('recurrente', 'parcialidad')
       AND (type = 'recurrente' OR installment_current < installment_total)`,
    [registryId],
  );
  return result.rows[0].cnt as number;
}

/** HTTP 402 body shape used by every enforcement touchpoint. */
export function upgradeRequired(
  reason: "owned_registries" | "members" | "templates" | "history",
): Response {
  return Response.json({ code: "upgrade_required", reason }, { status: 402 });
}

/**
 * Thrown by `store.useInvitation` when the TARGET registry is at its
 * free-plan member cap. The join route maps it (via instanceof) to a
 * localized 402 upgrade payload — a class rather than a string sentinel so
 * the catch can't drift if the message text ever changes.
 */
export class GroupFullError extends Error {
  constructor() {
    super("GROUP_FULL");
    this.name = "GroupFullError";
  }
}
