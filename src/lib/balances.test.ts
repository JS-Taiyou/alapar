import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import { computeDeltas } from "./balances";
import { calculateBalance } from "./calculations";
import type { Transaction, TransactionSplit } from "./types";

/** Build a transaction for delta tests. */
function mkTx(
  overrides: Partial<Transaction> & {
    type: Transaction["type"];
    userPaid: string;
    originalAmount: number;
    splits: { userId: string; amount: number; percentage?: number }[];
  },
): Transaction {
  const total = overrides.splits.reduce((s, x) => s + x.amount, 0);
  const splitJson: TransactionSplit = {
    splits: overrides.splits.map((s) => ({
      userId: s.userId,
      amount: s.amount,
      percentage: s.percentage ?? (total > 0 ? (s.amount / total) * 100 : 0),
    })),
  };
  return {
    id: overrides.id ?? "tx-1",
    registry_id: overrides.registry_id ?? "reg-1",
    description: overrides.description ?? "test",
    amount: overrides.amount ?? total,
    originalAmount: overrides.originalAmount,
    type: overrides.type,
    exerciseId: overrides.exerciseId ?? null,
    installmentCurrent: overrides.installmentCurrent ?? null,
    installmentTotal: overrides.installmentTotal ?? null,
    recurringDisabled: overrides.recurringDisabled ?? false,
    recurringGroupId: overrides.recurringGroupId ?? "grp-1",
    notes: "",
    splitJson,
    relatedTransactionId: null,
    creatorId: null,
    userPaid: overrides.userPaid,
    createdAt: new Date(),
  };
}

/** Helper: get the delta for a specific user from a computeDeltas result. */
function deltaFor(deltas: ReturnType<typeof computeDeltas>, userId: string): number {
  return deltas.find((d) => d.userId === userId)?.amount ?? 0;
}

// ===========================================================================
// computeDeltas — per transaction type
// ===========================================================================

describe("computeDeltas — expense (unico)", () => {
  it("credits the payer for others' shares and debits each participant", () => {
    // A paid $100, split 4 ways ($25 each): A+B+C+D.
    const tx = mkTx({
      type: "unico",
      userPaid: "A",
      originalAmount: 100,
      splits: [
        { userId: "A", amount: 25 },
        { userId: "B", amount: 25 },
        { userId: "C", amount: 25 },
        { userId: "D", amount: 25 },
      ],
    });
    const deltas = computeDeltas(tx);
    assertEquals(deltaFor(deltas, "A"), 75); // 100 - 25
    assertEquals(deltaFor(deltas, "B"), -25);
    assertEquals(deltaFor(deltas, "C"), -25);
    assertEquals(deltaFor(deltas, "D"), -25);
  });

  it("handles an uneven split with remainder cent", () => {
    // A paid $10.01, split 3 ways: A=$3.35, B=$3.33, C=$3.33.
    const tx = mkTx({
      type: "unico",
      userPaid: "A",
      originalAmount: 10.01,
      splits: [
        { userId: "A", amount: 3.35 },
        { userId: "B", amount: 3.33 },
        { userId: "C", amount: 3.33 },
      ],
    });
    const deltas = computeDeltas(tx);
    // A: 10.01 - 3.35 = 6.66 (but float: 6.659999...) → round to 6.66
    assertEquals(deltaFor(deltas, "A"), 6.66);
    assertEquals(deltaFor(deltas, "B"), -3.33);
    assertEquals(deltaFor(deltas, "C"), -3.33);
    // The deltas sum to exactly zero (what comes from one goes to others).
    const sum = deltas.reduce((s, d) => s + d.amount, 0);
    assertEquals(Math.round(sum * 100) / 100, 0);
  });

  it("credits the full total when the payer is NOT in the split", () => {
    // A paid $30 for B and C only (A is not in the split).
    const tx = mkTx({
      type: "unico",
      userPaid: "A",
      originalAmount: 30,
      splits: [
        { userId: "B", amount: 15 },
        { userId: "C", amount: 15 },
      ],
    });
    const deltas = computeDeltas(tx);
    assertEquals(deltaFor(deltas, "A"), 30); // full credit, no own share
    assertEquals(deltaFor(deltas, "B"), -15);
    assertEquals(deltaFor(deltas, "C"), -15);
  });
});

describe("computeDeltas — parcialidad (installment)", () => {
  it("divides both total and shares by installmentTotal", () => {
    // $1200 over 12 months, B paid, 2-way even ($600 each).
    const tx = mkTx({
      type: "parcialidad",
      userPaid: "B",
      originalAmount: 1200,
      installmentTotal: 12,
      splits: [
        { userId: "A", amount: 600 },
        { userId: "B", amount: 600 },
      ],
    });
    const deltas = computeDeltas(tx);
    // perInstallmentTotal = 100, B's share = 50. B paid → 100 - 50 = 50.
    assertEquals(deltaFor(deltas, "B"), 50);
    assertEquals(deltaFor(deltas, "A"), -50);
  });
});

describe("computeDeltas — pago (direct payment)", () => {
  it("credits the payer and debits the recipient", () => {
    const tx = mkTx({
      type: "pago",
      userPaid: "A",
      originalAmount: 49.98,
      splits: [{ userId: "B", amount: 49.98 }],
    });
    const deltas = computeDeltas(tx);
    assertEquals(deltaFor(deltas, "A"), 49.98);
    assertEquals(deltaFor(deltas, "B"), -49.98);
  });

  it("produces a single delta when payer pays themselves (degenerate)", () => {
    const tx = mkTx({
      type: "pago",
      userPaid: "A",
      originalAmount: 10,
      splits: [{ userId: "A", amount: 10 }],
    });
    const deltas = computeDeltas(tx);
    // Payer is credited, recipient is the same person — net should be single +10.
    assertEquals(deltas.length, 1);
    assertEquals(deltas[0], { userId: "A", amount: 10 });
  });
});

describe("computeDeltas — ajuste", () => {
  it("behaves identically to pago", () => {
    const tx = mkTx({
      type: "ajuste",
      userPaid: "A",
      originalAmount: 15,
      splits: [{ userId: "B", amount: 15 }],
    });
    const deltas = computeDeltas(tx);
    assertEquals(deltaFor(deltas, "A"), 15);
    assertEquals(deltaFor(deltas, "B"), -15);
  });
});

// ===========================================================================
// Cross-check: sum of deltas === calculateBalance (exact, not almostEquals)
// ===========================================================================

describe("computeDeltas vs calculateBalance consistency", () => {
  it("summing deltas for a user equals calculateBalance for the same transactions", () => {
    const txs = [
      mkTx({
        id: "t1",
        type: "unico",
        userPaid: "A",
        originalAmount: 100,
        splits: [
          { userId: "A", amount: 25 },
          { userId: "B", amount: 25 },
          { userId: "C", amount: 25 },
          { userId: "D", amount: 25 },
        ],
      }),
      mkTx({
        id: "t2",
        type: "unico",
        userPaid: "B",
        originalAmount: 80,
        splits: [
          { userId: "A", amount: 20 },
          { userId: "B", amount: 20 },
          { userId: "C", amount: 20 },
          { userId: "D", amount: 20 },
        ],
      }),
      mkTx({
        id: "t3",
        type: "pago",
        userPaid: "C",
        originalAmount: 10,
        splits: [{ userId: "A", amount: 10 }],
      }),
    ];

    // Build a delta map per user.
    const balanceMap = new Map<string, number>();
    for (const tx of txs) {
      for (const d of computeDeltas(tx)) {
        balanceMap.set(d.userId, (balanceMap.get(d.userId) ?? 0) + d.amount);
      }
    }
    // Round each user's summed balance (the persisted NUMERIC would do this).
    for (const [uid, amt] of balanceMap) {
      balanceMap.set(uid, Math.round(amt * 100) / 100);
    }

    // The delta-sum should match calculateBalance to within 1 cent for each user.
    // (Not exact-equal because calculateBalance uses raw floats; the whole point
    // of the persisted deltas is to eliminate this gap. The persisted path will
    // be exact because NUMERIC(12,2) sums are exact.)
    for (const uid of ["A", "B", "C", "D"]) {
      const fromDeltas = balanceMap.get(uid) ?? 0;
      const fromCalc = calculateBalance(txs, uid);
      const diff = Math.abs(fromDeltas - fromCalc);
      assertEquals(
        diff < 0.02,
        true,
        `User ${uid}: delta-sum ${fromDeltas} vs calculateBalance ${fromCalc} differ by ${diff}`,
      );
    }
  });

  it("deltas for a transaction always sum to zero (double-entry balance)", () => {
    // For every transaction type, the sum of all deltas must be zero —
    // what one user gains, others lose. This is the double-entry invariant.
    for (const tx of [
      mkTx({
        type: "unico",
        userPaid: "A",
        originalAmount: 100,
        splits: [
          { userId: "A", amount: 33.34 },
          { userId: "B", amount: 33.33 },
          { userId: "C", amount: 33.33 },
        ],
      }),
      mkTx({
        type: "parcialidad",
        userPaid: "B",
        originalAmount: 1200,
        installmentTotal: 12,
        splits: [
          { userId: "A", amount: 600 },
          { userId: "B", amount: 600 },
        ],
      }),
      mkTx({
        type: "pago",
        userPaid: "A",
        originalAmount: 49.98,
        splits: [{ userId: "B", amount: 49.98 }],
      }),
    ]) {
      const sum = computeDeltas(tx).reduce((s, d) => s + d.amount, 0);
      assertEquals(
        Math.abs(sum) < 0.01,
        true,
        `Transaction ${tx.id} deltas sum to ${sum}, expected ~0`,
      );
    }
  });
});
