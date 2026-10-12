import { assert, assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import {
  filterSpawnCandidates,
  generateInviteCode,
  INVITE_ALPHABET_CHARS,
  type ResolvedInvitation,
  validateInvitation,
} from "./invite";
import type { Transaction } from "./types";

// ---------------------------------------------------------------------------
// generateInviteCode
// ---------------------------------------------------------------------------

describe("generateInviteCode", () => {
  it("returns an 8-character string", () => {
    assertEquals(generateInviteCode().length, 8);
  });

  it("only uses characters from the unambiguous alphabet", () => {
    const allowed = new Set(INVITE_ALPHABET_CHARS);
    // Sample many codes to exercise randomness.
    for (let i = 0; i < 500; i++) {
      const code = generateInviteCode();
      for (const ch of code) {
        assert(allowed.has(ch), `unexpected char "${ch}" in code "${code}"`);
      }
    }
  });

  it("never produces the ambiguous characters 0, O, 1, I", () => {
    const banned = new Set(["0", "O", "1", "I"]);
    for (let i = 0; i < 500; i++) {
      const code = generateInviteCode();
      for (const ch of code) {
        assert(!banned.has(ch), `banned char "${ch}" appeared in "${code}"`);
      }
    }
  });

  it("produces different codes across calls (non-constant)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(generateInviteCode());
    assert(codes.size > 1, "generateInviteCode returned the same code every time");
  });
});

// ---------------------------------------------------------------------------
// filterSpawnCandidates
// ---------------------------------------------------------------------------

/** Minimal transaction builder for spawn-candidate scenarios. */
function spawnTx(
  overrides: Partial<Transaction> & {
    type: "recurrente" | "parcialidad";
    recurringGroupId: string;
    createdAt: Date;
  },
): Transaction {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    registry_id: overrides.registry_id ?? "reg-1",
    description: overrides.description ?? "test",
    amount: overrides.amount ?? 100,
    originalAmount: overrides.originalAmount ?? 100,
    type: overrides.type,
    exerciseId: overrides.exerciseId ?? null,
    installmentCurrent: overrides.installmentCurrent ?? null,
    installmentTotal: overrides.installmentTotal ?? null,
    recurringDisabled: overrides.recurringDisabled ?? false,
    recurringGroupId: overrides.recurringGroupId,
    notes: "",
    splitJson: { splits: [] },
    relatedTransactionId: null,
    creatorId: null,
    userPaid: overrides.userPaid ?? "u1",
    createdAt: overrides.createdAt,
  };
}

describe("filterSpawnCandidates", () => {
  it("returns [] for empty input", () => {
    assertEquals(filterSpawnCandidates([]), []);
  });

  it("includes a recurrente that has been archived (exerciseId set)", () => {
    const t = spawnTx({
      type: "recurrente",
      recurringGroupId: "g1",
      exerciseId: "ex-1",
      createdAt: new Date("2024-01-01"),
    });
    assertEquals(filterSpawnCandidates([t]), [t]);
  });

  it("excludes a recurrente that is still active (exerciseId null)", () => {
    const t = spawnTx({
      type: "recurrente",
      recurringGroupId: "g1",
      exerciseId: null,
      createdAt: new Date("2024-01-01"),
    });
    assertEquals(filterSpawnCandidates([t]), []);
  });

  it("includes a parcialidad that is not fully paid (current < total)", () => {
    const t = spawnTx({
      type: "parcialidad",
      recurringGroupId: "g2",
      installmentCurrent: 3,
      installmentTotal: 12,
      createdAt: new Date("2024-01-01"),
    });
    assertEquals(filterSpawnCandidates([t]), [t]);
  });

  it("excludes a parcialidad that is fully paid (current === total)", () => {
    const t = spawnTx({
      type: "parcialidad",
      recurringGroupId: "g2",
      installmentCurrent: 12,
      installmentTotal: 12,
      createdAt: new Date("2024-01-01"),
    });
    assertEquals(filterSpawnCandidates([t]), []);
  });

  it("excludes a parcialidad where current > total", () => {
    const t = spawnTx({
      type: "parcialidad",
      recurringGroupId: "g2",
      installmentCurrent: 13,
      installmentTotal: 12,
      createdAt: new Date("2024-01-01"),
    });
    assertEquals(filterSpawnCandidates([t]), []);
  });

  it("excludes a parcialidad with null installment fields", () => {
    const t = spawnTx({
      type: "parcialidad",
      recurringGroupId: "g2",
      installmentCurrent: null,
      installmentTotal: null,
      createdAt: new Date("2024-01-01"),
    });
    assertEquals(filterSpawnCandidates([t]), []);
  });

  it("excludes the entire group when any member is disabled", () => {
    // Even though the archived recurrente would qualify, the disabled sibling
    // poisons the whole group.
    const archived = spawnTx({
      id: "archived",
      type: "recurrente",
      recurringGroupId: "g3",
      exerciseId: "ex-1",
      createdAt: new Date("2024-01-01"),
    });
    const disabled = spawnTx({
      id: "disabled",
      type: "recurrente",
      recurringGroupId: "g3",
      exerciseId: "ex-2",
      recurringDisabled: true,
      createdAt: new Date("2024-01-02"),
    });
    assertEquals(filterSpawnCandidates([archived, disabled]), []);
  });

  it("keeps only the latest member per group (by createdAt)", () => {
    // Two recurrente in the same group, both archived. The newer one wins.
    const older = spawnTx({
      id: "older",
      type: "recurrente",
      recurringGroupId: "g4",
      exerciseId: "ex-1",
      createdAt: new Date("2024-01-01"),
    });
    const newer = spawnTx({
      id: "newer",
      type: "recurrente",
      recurringGroupId: "g4",
      exerciseId: "ex-1",
      createdAt: new Date("2024-06-01"),
    });
    const result = filterSpawnCandidates([older, newer]);
    assertEquals(result.length, 1);
    assertEquals(result[0].id, "newer");
  });

  it("returns one candidate per group across multiple groups", () => {
    const a = spawnTx({
      id: "a",
      type: "recurrente",
      recurringGroupId: "ga",
      exerciseId: "ex-1",
      createdAt: new Date("2024-01-01"),
    });
    const b = spawnTx({
      id: "b",
      type: "parcialidad",
      recurringGroupId: "gb",
      installmentCurrent: 1,
      installmentTotal: 3,
      createdAt: new Date("2024-01-01"),
    });
    const result = filterSpawnCandidates([a, b]);
    assertEquals(result.length, 2);
    assertEquals(new Set(result.map((t) => t.id)), new Set(["a", "b"]));
  });
});

// ===========================================================================
// validateInvitation
// ===========================================================================

describe("validateInvitation", () => {
  const now = new Date("2024-06-15T12:00:00Z");
  const future = new Date("2024-12-31T00:00:00Z");
  const past = new Date("2024-01-01T00:00:00Z");

  const valid: ResolvedInvitation = {
    revokedAt: null,
    expiresAt: future,
    maxUses: null,
    currentUses: 0,
  };

  it("returns not-found when invitation is null", () => {
    assertEquals(validateInvitation(null, now), {
      ok: false,
      reason: "not-found",
    });
  });

  it("returns ok for a valid, unexpired, unlimited-use invitation", () => {
    assertEquals(validateInvitation(valid, now), { ok: true });
  });

  it("returns revoked when revokedAt is set", () => {
    assertEquals(validateInvitation({ ...valid, revokedAt: past }, now), {
      ok: false,
      reason: "revoked",
    });
  });

  it("returns expired when expiresAt is in the past", () => {
    assertEquals(validateInvitation({ ...valid, expiresAt: past }, now), {
      ok: false,
      reason: "expired",
    });
  });

  it("returns ok when expiresAt equals now (boundary: not strictly less)", () => {
    assertEquals(validateInvitation({ ...valid, expiresAt: now }, now), { ok: true });
  });

  it("returns ok when expiresAt is null (no expiry)", () => {
    assertEquals(validateInvitation({ ...valid, expiresAt: null }, now), { ok: true });
  });

  it("returns max-uses when currentUses >= maxUses", () => {
    assertEquals(validateInvitation({ ...valid, maxUses: 5, currentUses: 5 }, now), {
      ok: false,
      reason: "max-uses",
    });
  });

  it("returns ok when currentUses is one below maxUses", () => {
    assertEquals(validateInvitation({ ...valid, maxUses: 5, currentUses: 4 }, now), { ok: true });
  });

  it("returns ok when maxUses is null (unlimited) regardless of currentUses", () => {
    assertEquals(validateInvitation({ ...valid, maxUses: null, currentUses: 1000 }, now), {
      ok: true,
    });
  });
});
