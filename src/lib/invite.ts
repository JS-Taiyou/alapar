/**
 * Pure invitation + spawn-candidate logic.
 *
 * Extracted from `lib/store.ts` so it can be unit-tested without a database.
 *
 * - {@link generateInviteCode} produces an 8-character code from an
 *   unambiguous alphabet (no `0`, `O`, `1`, `I`) to avoid human transcription
 *   errors.
 * - {@link filterSpawnCandidates} implements the carry-forward eligibility
 *   rules: for each recurring group (deduped to the latest member), a
 *   `recurrente` is a candidate only if it has been archived into an exercise,
 *   and a `parcialidad` is a candidate only if it isn't fully paid off. Any
 *   group with a disabled member is excluded entirely.
 * - {@link validateInvitation} encodes the invitation-acceptance gate
 *   (not-found / revoked / expired / max-uses-reached) as a pure function of
 *   `(invitation, now)`, extracted from `useInvitation`.
 */
import type { Transaction } from "./types";

/** The resolved invitation shape used by {@link validateInvitation}. */
export interface ResolvedInvitation {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  currentUses: number;
}

/** Result of {@link validateInvitation}. */
export type InvitationValidation =
  | { ok: true }
  | { ok: false; reason: "not-found" | "revoked" | "expired" | "max-uses" };

/**
 * Pure invitation-acceptance gate. Returns `{ ok: true }` if the invitation is
 * usable, or `{ ok: false, reason }` describing why it isn't. Extracted from
 * `useInvitation`'s throw-chain so the rules can be tested without a DB.
 *
 * @param invitation `null` represents "no invitation found for this code".
 * @param now        The current time (passed in so tests are deterministic).
 */
export function validateInvitation(
  invitation: ResolvedInvitation | null,
  now: Date,
): InvitationValidation {
  if (!invitation) return { ok: false, reason: "not-found" };
  if (invitation.revokedAt) return { ok: false, reason: "revoked" };
  if (invitation.expiresAt && invitation.expiresAt < now) {
    return { ok: false, reason: "expired" };
  }
  if (invitation.maxUses !== null && invitation.currentUses >= invitation.maxUses) {
    return { ok: false, reason: "max-uses" };
  }
  return { ok: true };
}

/** Map a validation reason back to the user-facing error message. */
export const INVITATION_ERROR_MESSAGES: Record<
  Exclude<InvitationValidation, { ok: true }>["reason"],
  string
> = {
  "not-found": "Invitation not found",
  revoked: "Invitation has been revoked",
  expired: "Invitation has expired",
  "max-uses": "Invitation has reached max uses",
};

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generate an 8-character invite code from the unambiguous alphabet. */
export function generateInviteCode(): string {
  // CSPRNG (crypto.getRandomValues), not Math.random: invite codes are
  // bearer secrets. 256 is an exact multiple of the 32-char alphabet, so
  // `byte % length` is uniform (no modulo bias).
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = "";
  for (const byte of bytes) {
    code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  }
  return code;
}

/** The invite-code alphabet, exposed for tests/inspection. */
export const INVITE_ALPHABET_CHARS = INVITE_ALPHABET;

/**
 * Given the full set of recurring/parcialidad transactions for a registry,
 * return the subset eligible for carry-forward cloning.
 *
 * Rules:
 *   - Group by `recurringGroupId`; keep only the latest member per group.
 *   - If ANY member of a group has `recurringDisabled`, the whole group is
 *     excluded.
 *   - `recurrente` is a candidate only when `exerciseId !== null` (already
 *     archived by a cut).
 *   - `parcialidad` is a candidate only when `installmentCurrent` and
 *     `installmentTotal` are both non-null and `current < total`.
 */
export function filterSpawnCandidates(transactions: Transaction[]): Transaction[] {
  const disabledGroups = new Set<string>();
  for (const t of transactions) {
    if (t.recurringDisabled) disabledGroups.add(t.recurringGroupId);
  }

  const latestPerGroup = new Map<string, Transaction>();
  for (const t of transactions) {
    const existing = latestPerGroup.get(t.recurringGroupId);
    if (!existing || t.createdAt > existing.createdAt) {
      latestPerGroup.set(t.recurringGroupId, t);
    }
  }

  const candidates: Transaction[] = [];
  for (const t of latestPerGroup.values()) {
    if (disabledGroups.has(t.recurringGroupId)) continue;
    if (t.type === "recurrente") {
      if (t.exerciseId !== null) candidates.push(t);
    } else if (t.type === "parcialidad") {
      if (
        t.installmentCurrent !== null &&
        t.installmentTotal !== null &&
        t.installmentCurrent < t.installmentTotal
      ) {
        candidates.push(t);
      }
    }
  }
  return candidates;
}
