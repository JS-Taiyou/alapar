import { assertAlmostEquals, assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import {
  buildEqualSplit,
  buildFixedSplit,
  buildPercentageSplit,
  calculateBalance,
  calculateFullPairwiseBalances,
  calculatePairwiseBreakdown,
  computeDefaultPercentages,
} from "./calculations";
import type { DefaultSplit, Participant, Transaction } from "./types";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

/**
 * Build a transaction with sensible defaults so tests only specify what
 * matters for the scenario. Mirrors the shape stored in the DB / returned by
 * `rowToTransaction`.
 */
function tx(
  overrides: Omit<Partial<Transaction>, "splitJson"> & {
    userPaid: string;
    splitJson: {
      splits: { userId: string; amount: number; percentage?: number }[];
    };
  },
): Transaction {
  const total = overrides.splitJson.splits.reduce((s, x) => s + x.amount, 0);
  return {
    id: overrides.id ?? crypto.randomUUID(),
    registry_id: overrides.registry_id ?? "reg-1",
    description: overrides.description ?? "test tx",
    amount: overrides.amount ?? total,
    originalAmount: overrides.originalAmount ?? total,
    type: overrides.type ?? "unico",
    exerciseId: overrides.exerciseId ?? null,
    installmentCurrent: overrides.installmentCurrent ?? null,
    installmentTotal: overrides.installmentTotal ?? null,
    recurringDisabled: overrides.recurringDisabled ?? false,
    recurringGroupId: overrides.recurringGroupId ?? "grp-1",
    notes: overrides.notes ?? "",
    splitJson: {
      splits: overrides.splitJson.splits.map((s) => ({
        userId: s.userId,
        amount: s.amount,
        percentage: s.percentage ?? (total > 0 ? (s.amount / total) * 100 : 0),
      })),
    },
    relatedTransactionId: overrides.relatedTransactionId ?? null,
    creatorId: overrides.creatorId ?? null,
    userPaid: overrides.userPaid,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

/** Equal-split helper: divides `total` into `amount` per user (caller-supplied). */
function equalSplit(userIds: string[], amounts: number[]): { userId: string; amount: number }[] {
  return userIds.map((userId, i) => ({ userId, amount: amounts[i] }));
}

function participant(id: string, name = id): Participant {
  return { id, name, color: "#000000" };
}

const round = (n: number) => Math.round(n * 100) / 100;

// ===========================================================================
// calculateBalance
// ===========================================================================

describe("calculateBalance", () => {
  it("returns 0 for an empty transaction list", () => {
    assertEquals(calculateBalance([], "u1"), 0);
  });

  it("returns 0 when the user is not in any split", () => {
    const t = tx({
      userPaid: "u2",
      splitJson: { splits: equalSplit(["u2", "u3"], [50, 50]) },
    });
    assertEquals(calculateBalance([t], "u1"), 0);
  });

  describe("regular expense (unico)", () => {
    it("credits the payer for others' shares (paid $100, own share $25)", () => {
      // 4-way $100 split, u1 paid → u1 is owed $75
      const t = tx({
        userPaid: "u1",
        originalAmount: 100,
        amount: 100,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [25, 25, 25, 25]),
        },
      });
      assertEquals(calculateBalance([t], "u1"), 75);
    });

    it("debits a non-payer for their share", () => {
      const t = tx({
        userPaid: "u2",
        originalAmount: 100,
        amount: 100,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [25, 25, 25, 25]),
        },
      });
      assertEquals(calculateBalance([t], "u1"), -25);
    });

    it("is zero for the payer when they paid exactly their own share", () => {
      const t = tx({
        userPaid: "u1",
        originalAmount: 100,
        amount: 100,
        splitJson: { splits: equalSplit(["u1", "u2"], [100, 0]) },
      });
      assertEquals(calculateBalance([t], "u1"), 0);
    });
  });

  describe("parcialidad (installment)", () => {
    it("divides both total and split by installmentTotal", () => {
      // $1200 over 12 months, u1 paid, 2-way even split.
      // perInstallmentTotal = 100, perInstallmentSplit = 50
      // u1 paid → balance += 100 - 50 = 50
      const t = tx({
        type: "parcialidad",
        userPaid: "u1",
        originalAmount: 1200,
        amount: 1200,
        installmentTotal: 12,
        splitJson: { splits: equalSplit(["u1", "u2"], [600, 600]) },
      });
      assertEquals(calculateBalance([t], "u1"), 50);
    });

    it("debits a non-payer only the per-installment share", () => {
      const t = tx({
        type: "parcialidad",
        userPaid: "u2",
        originalAmount: 1200,
        amount: 1200,
        installmentTotal: 12,
        splitJson: { splits: equalSplit(["u1", "u2"], [600, 600]) },
      });
      // perInstallmentSplit = 600 / 12 = 50
      assertEquals(calculateBalance([t], "u1"), -50);
    });

    it("treats parcialidad with installmentTotal=0 as divisor 1 (no NaN)", () => {
      // Falsy installmentTotal → divisor is 1, not 0.
      const t = tx({
        type: "parcialidad",
        userPaid: "u1",
        originalAmount: 100,
        amount: 100,
        installmentTotal: 0,
        splitJson: { splits: equalSplit(["u1", "u2"], [50, 50]) },
      });
      assertEquals(calculateBalance([t], "u1"), 50);
    });
  });

  describe("recurrente", () => {
    it("behaves like unico (no installment divisor)", () => {
      const t = tx({
        type: "recurrente",
        userPaid: "u1",
        originalAmount: 1000,
        amount: 1000,
        splitJson: { splits: equalSplit(["u1", "u2"], [500, 500]) },
      });
      assertEquals(calculateBalance([t], "u1"), 500);
    });
  });

  describe("pago (direct payment)", () => {
    it("credits the payer the full amount", () => {
      const t = tx({
        type: "pago",
        userPaid: "u1",
        originalAmount: 80,
        amount: 80,
        splitJson: { splits: [{ userId: "u2", amount: 80 }] },
      });
      assertEquals(calculateBalance([t], "u1"), 80);
    });

    it("debits the recipient the full amount", () => {
      const t = tx({
        type: "pago",
        userPaid: "u2",
        originalAmount: 80,
        amount: 80,
        splitJson: { splits: [{ userId: "u1", amount: 80 }] },
      });
      assertEquals(calculateBalance([t], "u1"), -80);
    });

    it("does not debit a user who is neither payer nor recipient", () => {
      const t = tx({
        type: "pago",
        userPaid: "u2",
        originalAmount: 80,
        amount: 80,
        splitJson: { splits: [{ userId: "u3", amount: 80 }] },
      });
      assertEquals(calculateBalance([t], "u1"), 0);
    });
  });

  describe("ajuste (balance adjustment)", () => {
    it("behaves like pago: payer +amount", () => {
      const t = tx({
        type: "ajuste",
        userPaid: "u1",
        originalAmount: 15,
        amount: 15,
        splitJson: { splits: [{ userId: "u2", amount: 15 }] },
      });
      assertEquals(calculateBalance([t], "u1"), 15);
    });

    it("behaves like pago: recipient -amount", () => {
      const t = tx({
        type: "ajuste",
        userPaid: "u2",
        originalAmount: 15,
        amount: 15,
        splitJson: { splits: [{ userId: "u1", amount: 15 }] },
      });
      assertEquals(calculateBalance([t], "u1"), -15);
    });
  });

  it("sums balance across many mixed transactions", () => {
    // u1 paid $100 dinner (4×$25) → +75
    // u2 paid $80 groceries (4×$20) → u1 -20
    // u1 paid u2 $55 (pago)        → +55
    // expected: 75 - 20 + 55 = 110
    const txs = [
      tx({
        userPaid: "u1",
        originalAmount: 100,
        amount: 100,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [25, 25, 25, 25]),
        },
      }),
      tx({
        userPaid: "u2",
        originalAmount: 80,
        amount: 80,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [20, 20, 20, 20]),
        },
      }),
      tx({
        type: "pago",
        userPaid: "u1",
        originalAmount: 55,
        amount: 55,
        splitJson: { splits: [{ userId: "u2", amount: 55 }] },
      }),
    ];
    assertEquals(calculateBalance(txs, "u1"), 110);
  });
});

// ===========================================================================
// calculatePairwiseBreakdown
// ===========================================================================

describe("calculatePairwiseBreakdown", () => {
  const fourUsers: Participant[] = [
    participant("u1", "Alice"),
    participant("u2", "Bob"),
    participant("u3", "Carol"),
    participant("u4", "Dave"),
  ];

  it("reproduces the documented 4-user example", () => {
    // Alice paid $120 dinner (4×$30), Bob paid $80 groceries (4×$20),
    // Carol paid $40 Uber (4×$10).
    // Alice's pairwise: Bob +10, Carol +20, Dave +30.
    const txs = [
      tx({
        userPaid: "u1",
        originalAmount: 120,
        amount: 120,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [30, 30, 30, 30]),
        },
      }),
      tx({
        userPaid: "u2",
        originalAmount: 80,
        amount: 80,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [20, 20, 20, 20]),
        },
      }),
      tx({
        userPaid: "u3",
        originalAmount: 40,
        amount: 40,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [10, 10, 10, 10]),
        },
      }),
    ];
    const result = calculatePairwiseBreakdown(txs, "u1", fourUsers);
    assertEquals(result, [
      { userId: "u4", userName: "Dave", userColor: "#000000", amount: 30 },
      { userId: "u3", userName: "Carol", userColor: "#000000", amount: 20 },
      { userId: "u2", userName: "Bob", userColor: "#000000", amount: 10 },
    ]);
  });

  it("sorts creditors (positive) before debtors (negative)", () => {
    // u1 paid $100 (u1,u2,u3) → u2 owes ~33.33, u3 owes ~33.33
    // then u2 paid u1 $80 (pago) → u2 net flips negative
    const txs = [
      tx({
        userPaid: "u1",
        originalAmount: 100,
        amount: 100,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3"], [33.34, 33.33, 33.33]),
        },
      }),
      tx({
        type: "pago",
        userPaid: "u2",
        originalAmount: 80,
        amount: 80,
        splitJson: { splits: [{ userId: "u1", amount: 80 }] },
      }),
    ];
    const result = calculatePairwiseBreakdown(txs, "u1", fourUsers.slice(0, 3));
    // u2 net: 33.33 - 80 = -46.67 (u1 owes u2); u3 net: 33.33 (u3 owes u1)
    // sort desc → u3 (+) before u2 (-)
    assertEquals(result.length, 2);
    assertEquals(result[0].userId, "u3");
    assertEquals(result[1].userId, "u2");
    assertAlmostEquals(result[0].amount, 33.33, 1e-9);
    assertAlmostEquals(result[1].amount, -46.67, 1e-9);
  });

  it("filters out entries whose absolute amount is < $0.01", () => {
    // u1 paid $0.02 split with u2 → u2 owes 0.01 (kept); u3 owes 0.01 (kept)
    // u1 paid $0.01 split 4-way → each share 0.0025 (< 0.01, filtered)
    const txs = [
      tx({
        userPaid: "u1",
        originalAmount: 0.015,
        amount: 0.015,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [0.00375, 0.00375, 0.00375, 0.00375]),
        },
      }),
    ];
    const result = calculatePairwiseBreakdown(txs, "u1", fourUsers);
    assertEquals(result, []);
  });

  it("silently ignores transactions whose payer is not a participant", () => {
    // Payer "u9" is not in allParticipants → net["u9"] undefined → skipped.
    // u1 is in the split but didn't pay → would normally debit the payer,
    // but payer is absent so nothing happens.
    const t = tx({
      userPaid: "u9",
      originalAmount: 100,
      amount: 100,
      splitJson: { splits: equalSplit(["u1", "u2"], [50, 50]) },
    });
    const result = calculatePairwiseBreakdown([t], "u1", fourUsers);
    assertEquals(result, []);
  });

  it("silently ignores split members who are not participants", () => {
    // u1 paid; split includes "u9" (not a participant) → that share is dropped.
    const t = tx({
      userPaid: "u1",
      originalAmount: 100,
      amount: 100,
      splitJson: {
        splits: equalSplit(["u1", "u2", "u9"], [33.34, 33.33, 33.33]),
      },
    });
    const result = calculatePairwiseBreakdown([t], "u1", fourUsers);
    // only u2's share counts toward u1's net
    assertEquals(result, [{ userId: "u2", userName: "Bob", userColor: "#000000", amount: 33.33 }]);
  });

  it("handles pago: payer credited against the recipient only", () => {
    const t = tx({
      type: "pago",
      userPaid: "u1",
      originalAmount: 30,
      amount: 30,
      splitJson: { splits: [{ userId: "u3", amount: 30 }] },
    });
    const result = calculatePairwiseBreakdown([t], "u1", fourUsers);
    assertEquals(result, [{ userId: "u3", userName: "Carol", userColor: "#000000", amount: 30 }]);
  });

  it("applies the parcialidad divisor to pairwise shares", () => {
    // $1200 / 12 = 100/mo; u1 paid; 2-way → u2 owes 50/mo
    const t = tx({
      type: "parcialidad",
      userPaid: "u1",
      originalAmount: 1200,
      amount: 1200,
      installmentTotal: 12,
      splitJson: { splits: equalSplit(["u1", "u2"], [600, 600]) },
    });
    const result = calculatePairwiseBreakdown([t], "u1", [participant("u1"), participant("u2")]);
    assertEquals(result, [{ userId: "u2", userName: "u2", userColor: "#000000", amount: 50 }]);
  });

  it("returns empty when current user has no net with anyone", () => {
    const t = tx({
      userPaid: "u2",
      originalAmount: 100,
      amount: 100,
      splitJson: { splits: equalSplit(["u2", "u3"], [50, 50]) },
    });
    const result = calculatePairwiseBreakdown([t], "u1", fourUsers);
    assertEquals(result, []);
  });

  it("aggregate of pairwise nets equals calculateBalance for a single user", () => {
    // Cross-check invariant: sum of pairwise == aggregate balance.
    const txs = [
      tx({
        userPaid: "u1",
        originalAmount: 120,
        amount: 120,
        splitJson: {
          splits: equalSplit(["u1", "u2", "u3", "u4"], [30, 30, 30, 30]),
        },
      }),
      tx({
        type: "pago",
        userPaid: "u2",
        originalAmount: 10,
        amount: 10,
        splitJson: { splits: [{ userId: "u1", amount: 10 }] },
      }),
    ];
    const pairwise = calculatePairwiseBreakdown(txs, "u1", fourUsers);
    const sum = round(pairwise.reduce((s, e) => s + e.amount, 0));
    const aggregate = calculateBalance(txs, "u1");
    assertAlmostEquals(sum, aggregate, 1e-9);
  });
});

// ===========================================================================
// calculateFullPairwiseBalances
// ===========================================================================

describe("calculateFullPairwiseBalances", () => {
  const users: Participant[] = [
    participant("u1", "Alice"),
    participant("u2", "Bob"),
    participant("u3", "Carol"),
  ];

  it("produces one debt per pair, netted, with correct direction", () => {
    // u1 paid $90 (3×$30) → u2 owes u1 $30, u3 owes u1 $30.
    const t = tx({
      userPaid: "u1",
      originalAmount: 90,
      amount: 90,
      splitJson: { splits: equalSplit(["u1", "u2", "u3"], [30, 30, 30]) },
    });
    const debts = calculateFullPairwiseBalances([t], users);
    assertEquals(debts.length, 2);
    // each debt: from debtor → to creditor
    const owesAlice = debts.filter((d) => d.toUserId === "u1");
    assertEquals(owesAlice.length, 2);
    assertEquals(
      owesAlice.every((d) => d.amount === 30),
      true,
    );
  });

  it("nets opposing flows between the same pair into a single debt", () => {
    // u1 paid $60 (u1,u2 → u2 owes u1 $30)
    // u2 paid $20 (u1,u2 → u1 owes u2 $10)
    // net: u2 owes u1 $20.
    const txs = [
      tx({
        userPaid: "u1",
        originalAmount: 60,
        amount: 60,
        splitJson: { splits: equalSplit(["u1", "u2"], [30, 30]) },
      }),
      tx({
        userPaid: "u2",
        originalAmount: 20,
        amount: 20,
        splitJson: { splits: equalSplit(["u1", "u2"], [10, 10]) },
      }),
    ];
    const debts = calculateFullPairwiseBalances([txs[0], txs[1]], users);
    const u1u2 = debts.find(
      (d) =>
        (d.fromUserId === "u1" && d.toUserId === "u2") ||
        (d.fromUserId === "u2" && d.toUserId === "u1"),
    );
    assertEquals(u1u2, {
      fromUserId: "u2",
      fromUserName: "Bob",
      toUserId: "u1",
      toUserName: "Alice",
      amount: 20,
    });
  });

  it("skips pairs whose net is < $0.01", () => {
    // 0.004 each → net 0.004, rounds to 0.00 (< 0.01) → skipped.
    const t = tx({
      userPaid: "u1",
      originalAmount: 0.008,
      amount: 0.008,
      splitJson: { splits: equalSplit(["u1", "u2"], [0.004, 0.004]) },
    });
    const debts = calculateFullPairwiseBalances([t], users);
    assertEquals(debts, []);
  });

  it("returns no debt for an empty transaction list", () => {
    assertEquals(calculateFullPairwiseBalances([], users), []);
  });
});

// ===========================================================================
// buildEqualSplit
// ===========================================================================

describe("buildEqualSplit", () => {
  it("splits evenly when total divides cleanly", () => {
    const result = buildEqualSplit(100, ["a", "b"]);
    assertEquals(result.splits, [
      { userId: "a", percentage: 50, amount: 50 },
      { userId: "b", percentage: 50, amount: 50 },
    ]);
  });

  it("assigns the cent remainder to the first user (100 / 3)", () => {
    const result = buildEqualSplit(100, ["a", "b", "c"]);
    // a gets the extra cent: 33.33 + 0.01 → 33.34 (floating point gives
    // 33.339999... so we assert with tolerance).
    assertAlmostEquals(result.splits[0].amount, 33.34, 1e-9);
    assertEquals(result.splits[1].amount, 33.33);
    assertEquals(result.splits[2].amount, 33.33);
    // amounts sum back to the total exactly
    const sum = round(result.splits.reduce((s, x) => s + x.amount, 0));
    assertEquals(sum, 100);
  });

  it("handles tiny totals with rounding (0.10 / 3)", () => {
    const result = buildEqualSplit(0.1, ["a", "b", "c"]);
    assertEquals(result.splits[0].amount, 0.04);
    assertEquals(result.splits[1].amount, 0.03);
    assertEquals(result.splits[2].amount, 0.03);
    const sum = round(result.splits.reduce((s, x) => s + x.amount, 0));
    assertEquals(sum, 0.1);
  });

  it("assigns the whole amount to the single user when count=1", () => {
    const result = buildEqualSplit(42.5, ["solo"]);
    assertEquals(result.splits, [
      {
        userId: "solo",
        percentage: 100,
        amount: 42.5,
      },
    ]);
  });

  it("produces equal percentages for all users", () => {
    const result = buildEqualSplit(90, ["a", "b", "c"]);
    assertEquals(
      result.splits.every((s) => s.percentage === 33.33),
      true,
    );
  });

  it("sums amounts to the original total even for tricky values", () => {
    // Property-style: many random-ish totals over 4 users should round-trip.
    for (const total of [0.03, 1.99, 33.33, 1000, 0.01, 7.77]) {
      const result = buildEqualSplit(total, ["a", "b", "c", "d"]);
      const sum = round(result.splits.reduce((s, x) => s + x.amount, 0));
      assertAlmostEquals(sum, total, 1e-9);
    }
  });
});

// ===========================================================================
// buildPercentageSplit
// ===========================================================================

describe("buildPercentageSplit", () => {
  it("computes amounts from percentages", () => {
    const result = buildPercentageSplit(200, [
      { userId: "a", percentage: 25 },
      { userId: "b", percentage: 75 },
    ]);
    assertEquals(result.splits, [
      { userId: "a", percentage: 25, amount: 50 },
      { userId: "b", percentage: 75, amount: 150 },
    ]);
  });

  it("rounds fractional cents correctly via integer arithmetic", () => {
    // 33.33% of 100: toCents(100)=10000, 10000 * 33.33 / 100 = 3333 → 33.33
    // (The old float path produced 33 due to float rounding; integer cents is exact.)
    const result = buildPercentageSplit(100, [{ userId: "a", percentage: 33.33 }]);
    assertEquals(result.splits[0].amount, 33.33);
  });

  it("preserves the percentages verbatim", () => {
    const result = buildPercentageSplit(100, [
      { userId: "a", percentage: 40 },
      { userId: "b", percentage: 60 },
    ]);
    assertEquals(
      result.splits.map((s) => s.percentage),
      [40, 60],
    );
  });
});

// ===========================================================================
// buildFixedSplit
// ===========================================================================

describe("buildFixedSplit", () => {
  it("derives percentages from fixed amounts", () => {
    const result = buildFixedSplit(100, [
      { userId: "a", amount: 30 },
      { userId: "b", amount: 70 },
    ]);
    assertEquals(result.splits, [
      { userId: "a", percentage: 30, amount: 30 },
      { userId: "b", percentage: 70, amount: 70 },
    ]);
  });

  it("returns 0% for everyone when total is 0 (no div-by-zero)", () => {
    const result = buildFixedSplit(0, [
      { userId: "a", amount: 0 },
      { userId: "b", amount: 0 },
    ]);
    assertEquals(
      result.splits.every((s) => s.percentage === 0),
      true,
    );
  });

  it("keeps the supplied amounts unchanged", () => {
    const result = buildFixedSplit(250, [
      { userId: "a", amount: 100 },
      { userId: "b", amount: 150 },
    ]);
    assertEquals(
      result.splits.map((s) => s.amount),
      [100, 150],
    );
  });
});

// ===========================================================================
// computeDefaultPercentages
// ===========================================================================

describe("computeDefaultPercentages", () => {
  const three = [participant("a"), participant("b"), participant("c")];

  it("returns even split when defaultSplit is null", () => {
    const result = computeDefaultPercentages(three, null);
    assertEquals(result, { a: 33.33, b: 33.33, c: 33.33 });
  });

  it("returns even split when member count has changed", () => {
    // saved for 2 members, now 3 → fallback
    const saved: DefaultSplit = {
      splits: [
        { userId: "a", percentage: 50 },
        { userId: "b", percentage: 50 },
      ],
    };
    const result = computeDefaultPercentages(three, saved);
    assertEquals(result, { a: 33.33, b: 33.33, c: 33.33 });
  });

  it("returns even split when a saved userId is no longer a participant", () => {
    const saved: DefaultSplit = {
      splits: [
        { userId: "a", percentage: 40 },
        { userId: "x", percentage: 60 }, // x is not in `three`
      ],
    };
    const result = computeDefaultPercentages(three, saved);
    assertEquals(result, { a: 33.33, b: 33.33, c: 33.33 });
  });

  it("returns the saved percentages when they match participants exactly", () => {
    const saved: DefaultSplit = {
      splits: [
        { userId: "a", percentage: 50 },
        { userId: "b", percentage: 20 },
        { userId: "c", percentage: 30 },
      ],
    };
    const result = computeDefaultPercentages(three, saved);
    assertEquals(result, { a: 50, b: 20, c: 30 });
  });

  it("gives 25% each for 4 participants with no default", () => {
    const four = [participant("a"), participant("b"), participant("c"), participant("d")];
    const result = computeDefaultPercentages(four, null);
    assertEquals(result, { a: 25, b: 25, c: 25, d: 25 });
  });
});
