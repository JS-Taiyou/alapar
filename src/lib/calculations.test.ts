import { assertAlmostEquals, assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import {
  buildEqualSplit,
  buildFixedSplit,
  buildPercentageSplit,
  calculateBalance,
  calculateFullPairwiseBalances,
  calculatePairwiseBreakdown,
  checkSplitSum,
  completePercentages,
  computeDefaultPercentages,
  equalPercentages,
  isEvenPercentages,
  isEqualSplit,
  percentagesFromAmounts,
  resolveTransactionSplit,
  sameSplitCents,
  splitSumTolerance,
  untouchedSplit,
} from "./calculations";
import { parseTransactionForm } from "./transaction-validation";
import type { DefaultSplit, Participant, SplitEntry, Transaction } from "./types";

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

describe("completePercentages", () => {
  it("hands a residue above 100 to the first entry", () => {
    const six = Object.fromEntries("abcdef".split("").map((id) => [id, 16.67]));
    const result = completePercentages(six);
    assertEquals(result.a, 16.65);
    assertEquals(Math.round(Object.values(result).reduce((s, v) => s + v, 0) * 100), 10000);
  });
});

describe("computeDefaultPercentages", () => {
  const three = [participant("a"), participant("b"), participant("c")];

  it("returns even split when defaultSplit is null", () => {
    const result = computeDefaultPercentages(three, null);
    assertEquals(result, { a: 33.34, b: 33.33, c: 33.33 });
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
    assertEquals(result, { a: 33.34, b: 33.33, c: 33.33 });
  });

  it("returns even split when a saved userId is no longer a participant", () => {
    const saved: DefaultSplit = {
      splits: [
        { userId: "a", percentage: 40 },
        { userId: "x", percentage: 60 }, // x is not in `three`
      ],
    };
    const result = computeDefaultPercentages(three, saved);
    assertEquals(result, { a: 33.34, b: 33.33, c: 33.33 });
  });

  it("hands the rounding remainder to whoever is first in the book's line", () => {
    // a took the last leftover cent, so b is next; c has never taken one and
    // goes before both.
    assertEquals(computeDefaultPercentages(three, null, ["a", "b"]), {
      a: 33.33,
      b: 33.33,
      c: 33.34,
    });
    assertEquals(computeDefaultPercentages(three, null, ["a"]), { a: 33.33, b: 33.34, c: 33.33 });
    assertEquals(
      Object.values(computeDefaultPercentages(three, null, ["a"])).filter((p) => p === 33.34)
        .length,
      1,
    );
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

  it("completes a saved even three-way split that misses 100% by a rounding residue", () => {
    const saved: DefaultSplit = {
      splits: [
        { userId: "a", percentage: 33.33 },
        { userId: "b", percentage: 33.33 },
        { userId: "c", percentage: 33.33 },
      ],
    };
    // 33.33 × 3 = 99.99 left $0.15 of a $1,500 expense unassigned.
    assertEquals(computeDefaultPercentages(three, saved), { a: 33.34, b: 33.33, c: 33.33 });
    // The residue follows the line, not the member it was saved on.
    assertEquals(computeDefaultPercentages(three, saved, ["a", "b"]), {
      a: 33.33,
      b: 33.33,
      c: 33.34,
    });
  });

  it("deals a saved even split by the line, wherever its odd hundredth was saved", () => {
    const saved: DefaultSplit = {
      splits: [
        { userId: "a", percentage: 33.34 },
        { userId: "b", percentage: 33.33 },
        { userId: "c", percentage: 33.33 },
      ],
    };
    assertEquals(computeDefaultPercentages(three, saved, ["a", "b"]), {
      a: 33.33,
      b: 33.33,
      c: 33.34,
    });
  });

  it("leaves saved percentages that are further off alone", () => {
    const saved: DefaultSplit = {
      splits: [
        { userId: "a", percentage: 50 },
        { userId: "b", percentage: 20 },
        { userId: "c", percentage: 20 },
      ],
    };
    assertEquals(computeDefaultPercentages(three, saved), { a: 50, b: 20, c: 20 });
  });

  it("gives 25% each for 4 participants with no default", () => {
    const four = [participant("a"), participant("b"), participant("c"), participant("d")];
    const result = computeDefaultPercentages(four, null);
    assertEquals(result, { a: 25, b: 25, c: 25, d: 25 });
  });
});

// ===========================================================================
// equalPercentages
// ===========================================================================

describe("equalPercentages", () => {
  const sum = (percentages: Record<string, number>) =>
    Object.values(percentages).reduce((s, v) => s + v, 0);

  it("adds up to exactly 100 for three members (the remainder goes to one)", () => {
    const result = equalPercentages(["a", "b", "c"]);
    assertEquals(result, { a: 33.34, b: 33.33, c: 33.33 });
    assertAlmostEquals(sum(result), 100, 1e-9);
  });

  it("is exact when the member count divides 100", () => {
    assertEquals(equalPercentages(["a", "b"]), { a: 50, b: 50 });
    assertEquals(equalPercentages(["a", "b", "c", "d"]), { a: 25, b: 25, c: 25, d: 25 });
  });

  it("moves the remainder along the line, as buildEqualSplit moves the cent", () => {
    const userIds = ["a", "b", "c"];
    let line: string[] = [];
    const withExtra: string[] = [];
    for (let i = 0; i < 6; i++) {
      const percentages = equalPercentages(userIds, line);
      const extra = Object.keys(percentages).filter((id) => percentages[id] === 33.34);
      assertEquals(extra.length, 1);
      assertAlmostEquals(sum(percentages), 100, 1e-9);
      // Same line, same member: the one buildEqualSplit gives the extra cent.
      const amounts = buildEqualSplit(100, userIds, line).splits;
      assertEquals(amounts.find((s) => s.userId === extra[0])?.amount, 33.34);
      withExtra.push(extra[0]);
      line = resolveTransactionSplit("auto", 100, { splits: amounts }, line).line;
    }
    assertEquals(withExtra, ["a", "b", "c", "a", "b", "c"]);
  });

  it("yields a complete split when applied to a total", () => {
    const percentages = equalPercentages(["a", "b", "c"]);
    const entries = Object.entries(percentages).map(([userId, percentage]) => ({
      userId,
      percentage,
    }));
    // Whole-dollar totals are matched to the cent.
    for (const total of [100, 1500, 2500]) {
      const amounts = buildPercentageSplit(total, entries).splits.map((s) => s.amount);
      assertAlmostEquals(round(amounts.reduce((s, a) => s + a, 0)), total, 1e-9);
    }
    // Any other total only drifts by rounding, within what the server allows.
    for (const total of [100.05, 2500.57, 0.03]) {
      const amounts = buildPercentageSplit(total, entries).splits.map((s) => s.amount);
      assertEquals(checkSplitSum(total, amounts).ok, true);
    }
  });

  it("fixes the old even default, which left cents unassigned", () => {
    // 33.33 × 3 = 99.99: $0.15 short on a $1,500 expense — the server refuses.
    const old = buildPercentageSplit(1500, [
      { userId: "a", percentage: 33.33 },
      { userId: "b", percentage: 33.33 },
      { userId: "c", percentage: 33.33 },
    ]);
    assertEquals(round(old.splits.reduce((s, x) => s + x.amount, 0)), 1499.85);
    assertEquals(
      checkSplitSum(
        1500,
        old.splits.map((s) => s.amount),
      ).ok,
      false,
    );
  });
});

// ===========================================================================
// isEvenPercentages / sameSplitCents
// ===========================================================================

describe("isEvenPercentages", () => {
  it("recognises an even split written with two decimals", () => {
    assertEquals(isEvenPercentages({ a: 33.34, b: 33.33, c: 33.33 }), true);
    assertEquals(isEvenPercentages({ a: 33.33, b: 33.33, c: 33.33 }), true);
    assertEquals(isEvenPercentages({ a: 50, b: 50 }), true);
    // Six members: four hold 16.67 and two hold 16.66.
    assertEquals(
      isEvenPercentages({ a: 16.67, b: 16.67, c: 16.67, d: 16.67, e: 16.66, f: 16.66 }),
      true,
    );
  });

  it("does not mistake a custom split for an even one", () => {
    assertEquals(isEvenPercentages({ a: 34, b: 33, c: 33 }), false);
    assertEquals(isEvenPercentages({ a: 50.01, b: 49.99 }), false);
    assertEquals(isEvenPercentages({ a: 33.35, b: 33.33, c: 33.33 }), false);
    assertEquals(isEvenPercentages({ a: 100 }), false);
    assertEquals(isEvenPercentages({}), false);
  });
});

describe("sameSplitCents", () => {
  it("is true only when every member has the same cents in the same order", () => {
    const saved = [
      { userId: "a", percentage: 50, amount: 5.06 },
      { userId: "b", percentage: 50, amount: 5.05 },
    ];
    assertEquals(
      sameSplitCents(saved, [
        { userId: "a", percentage: 50, amount: 5.06 },
        { userId: "b", percentage: 50, amount: 5.05 },
      ]),
      true,
    );
    assertEquals(
      sameSplitCents(saved, [
        { userId: "a", percentage: 50, amount: 5.05 },
        { userId: "b", percentage: 50, amount: 5.06 },
      ]),
      false,
    );
    assertEquals(sameSplitCents(saved, [saved[1], saved[0]]), false);
    assertEquals(sameSplitCents(saved, [saved[0]]), false);
  });
});

// ===========================================================================
// resolveTransactionSplit — the split the server saves
// ===========================================================================

describe("resolveTransactionSplit", () => {
  const entries = (rows: [string, number, number][]) => ({
    splits: rows.map(([userId, percentage, amount]) => ({ userId, percentage, amount })),
  });
  const amounts = (split: { splits: SplitEntry[] }) => split.splits.map((s) => s.amount);

  it("Auto: whole cents that add up, the leftover cent dealt by the line", () => {
    const sent = entries([
      ["x", 50, 5.06],
      ["y", 50, 5.05],
    ]);
    const dealt = resolveTransactionSplit("auto", 10.11, sent, []);
    assertEquals(dealt.split, {
      mode: "auto",
      splits: [
        { userId: "x", percentage: 50, amount: 5.06 },
        { userId: "y", percentage: 50, amount: 5.05 },
      ],
    });
    assertEquals(dealt.line, ["x"]);
    const next = resolveTransactionSplit("auto", 10.11, sent, dealt.line);
    assertEquals(amounts(next.split), [5.05, 5.06]);
    assertEquals(next.line, ["x", "y"]);
  });

  it("Auto: the line beats the cents the form sent", () => {
    // The form predicted the cent for y; the book's line gives it to x.
    const dealt = resolveTransactionSplit(
      "auto",
      10.11,
      entries([
        ["x", 50, 5.05],
        ["y", 50, 5.06],
      ]),
      [],
    );
    assertEquals(amounts(dealt.split), [5.06, 5.05]);
  });

  it("Porcentaje: a tie goes to whoever is first in line", () => {
    const sent = entries([
      ["x", 50, 5.05],
      ["y", 50, 5.06],
    ]);
    const dealt = resolveTransactionSplit("percentage", 10.11, sent, ["x", "y"]);
    assertEquals(amounts(dealt.split), [5.06, 5.05]);
    assertEquals(dealt.line, ["y", "x"]);
  });

  it("Porcentaje: a cent the percentages already decide is that member's", () => {
    // 33.34 / 33.33 / 33.33 of $10.00 → 3.334, 3.333, 3.333.
    const sent = entries([
      ["a", 33.34, 3.34],
      ["b", 33.33, 3.33],
      ["c", 33.33, 3.33],
    ]);
    const dealt = resolveTransactionSplit("percentage", 10, sent, ["c", "b", "a"]);
    assertEquals(amounts(dealt.split), [3.34, 3.33, 3.33]);
    // a took a cent, so a takes a turn (and was already last).
    assertEquals(dealt.line, ["c", "b", "a"]);
    assertEquals(resolveTransactionSplit("percentage", 10, sent, ["a", "b", "c"]).line, [
      "b",
      "c",
      "a",
    ]);
  });

  it("Porcentaje: the odd hundredth of an even split takes a turn even when every share is exact", () => {
    // 33.34 / 33.33 / 33.33 of $1,500 → 500.10 / 499.95 / 499.95: nothing is
    // left over, yet a pays $0.15 more than an even third.
    const sent = entries([
      ["a", 33.34, 500.1],
      ["b", 33.33, 499.95],
      ["c", 33.33, 499.95],
    ]);
    const dealt = resolveTransactionSplit("percentage", 1500, sent, ["a", "b", "c"]);
    assertEquals(amounts(dealt.split), [500.1, 499.95, 499.95]);
    assertEquals(dealt.line, ["b", "c", "a"]);
  });

  /** What the form does with an even three-way split: seed the percentages by the line, round each share, deal, keep the line. */
  function saveEven(total: number, line: string[]) {
    const ids = ["a", "b", "c"];
    const percentages = equalPercentages(ids, line);
    const sent = buildPercentageSplit(
      total,
      ids.map((userId) => ({ userId, percentage: percentages[userId] })),
    );
    const dealt = resolveTransactionSplit("percentage", total, sent, line);
    const shares = dealt.split.splits.map((s) => s.amount);
    return {
      holder: ids.find((id) => percentages[id] === 33.34)!,
      line: dealt.line,
      /** The line as the deal saw it: members it had never seen go first. */
      order: [...ids.filter((id) => !line.includes(id)), ...line],
      /** Members who ended up paying more than the smallest share. */
      paidMore: ids.filter((_, i) => shares[i] > Math.min(...shares)),
      /** Members who took a turn and went to the back. */
      took: dealt.took,
    };
  }

  const balanced = (counts: number[]) => Math.max(...counts) - Math.min(...counts) <= 1;

  it("so the odd hundredth of an even split moves to the next member each time when that is all that is at stake", () => {
    // $1,500: every share is exact, so the odd hundredth is the only difference.
    let line: string[] = [];
    const holders: string[] = [];
    for (let i = 0; i < 7; i++) {
      const saved = saveEven(1500, line);
      holders.push(saved.holder);
      line = saved.line;
    }
    assertEquals(holders, ["a", "b", "c", "a", "b", "c", "a"]);
  });

  it("gives it to the member whose turn is next, and nobody pays more without taking a turn", () => {
    const totals = [1500, 10, 1500, 20.02, 10.01, 33.33, 0.01, 100, 7.77, 0.02];
    let line: string[] = [];
    const turns: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 90; i++) {
      const saved = saveEven(totals[i % totals.length], line);
      assertEquals(saved.holder, saved.order[0], `expense ${i}: the holder is first in line`);
      for (const id of saved.paidMore) {
        assertEquals(
          saved.took.includes(id),
          true,
          `expense ${i} (${totals[i % totals.length]}): ${id} paid more and kept their place`,
        );
      }
      for (const id of saved.took) turns[id]++;
      line = saved.line;
    }
    assertEquals(balanced(Object.values(turns)), true, JSON.stringify(turns));
  });

  it("the same expense repeated spreads the extra cents evenly", () => {
    for (const total of [10, 10.01, 10.02, 1500, 0.01, 33.33]) {
      let line: string[] = [];
      const paidMore: Record<string, number> = { a: 0, b: 0, c: 0 };
      for (let i = 0; i < 30; i++) {
        const saved = saveEven(total, line);
        for (const id of saved.paidMore) paidMore[id]++;
        line = saved.line;
      }
      assertEquals(
        balanced(Object.values(paidMore)),
        true,
        `${total}: ${JSON.stringify(paidMore)}`,
      );
    }
  });

  it("Porcentaje: completes a split that misses the total by a few cents of rounding", () => {
    // 33.33 × 3 of $500.00 comes to $499.95 — inside the server's slack, where
    // $0.05 used to vanish from the ledger. Dealt, it is $500.00 to the cent.
    const sent = buildPercentageSplit(
      500,
      ["a", "b", "c"].map((userId) => ({ userId, percentage: 33.33 })),
    );
    assertEquals(round(sent.splits.reduce((sum, s) => sum + s.amount, 0)), 499.95);
    const dealt = resolveTransactionSplit("percentage", 500, sent, []);
    assertEquals(amounts(dealt.split), [166.67, 166.67, 166.66]);
  });

  it("never saves a fraction of a cent or a cent more than the total", () => {
    const triples = [
      [33.34, 33.33, 33.33],
      [33.33, 33.33, 33.34],
      [50, 25, 25],
      [40, 30, 30],
      [60, 40, 0],
      [99.99, 0.005, 0.005],
      [16.67, 16.67, 16.67, 16.67, 16.67, 16.65],
    ];
    for (const triple of triples) {
      for (let cents = 1; cents <= 2500; cents += 7) {
        const sent = buildPercentageSplit(
          cents / 100,
          triple.map((percentage, i) => ({ userId: `u${i}`, percentage })),
        );
        const dealt = resolveTransactionSplit("percentage", cents / 100, sent, ["u2", "u0"]);
        const shares = dealt.split.splits.map((s) => Math.round(s.amount * 100));
        assertEquals(
          shares.reduce((sum, c) => sum + c, 0),
          cents,
          `${triple.join("/")} of ${cents} cents`,
        );
        for (const share of shares) {
          // Within a cent of the share the percentages give, rounded either way.
          assertEquals(Number.isInteger(share), true);
        }
      }
    }
  });

  it("keeps the percentages the form sent", () => {
    const sent = entries([
      ["a", 33.34, 3.34],
      ["b", 33.33, 3.33],
      ["c", 33.33, 3.33],
    ]);
    assertEquals(
      resolveTransactionSplit("percentage", 10, sent, []).split.splits.map((s) => s.percentage),
      [33.34, 33.33, 33.33],
    );
  });

  it("Monto Fijo is kept as typed and leaves the line alone", () => {
    const sent = entries([
      ["a", 60, 6.07],
      ["b", 40, 4.04],
    ]);
    const dealt = resolveTransactionSplit("fixed", 10.11, sent, ["b", "a"]);
    assertEquals(dealt.split, { splits: sent.splits, mode: "fixed" });
    assertEquals(dealt.line, ["b", "a"]);
  });

  it("without a mode the split is kept as sent", () => {
    const sent = entries([
      ["a", 50, 5.05],
      ["b", 50, 5.06],
    ]);
    assertEquals(resolveTransactionSplit(undefined, 10.11, sent, ["a"]), {
      split: sent,
      took: [],
      line: ["a"],
    });
  });

  it("the deal the form shows for Auto is the deal that gets saved", () => {
    for (const total of [0.01, 10.11, 99.99, 1234.56]) {
      for (const line of [[], ["b", "a"], ["c", "a", "b"]]) {
        const ids = ["a", "b", "c"];
        const shown = buildEqualSplit(total, ids, line);
        const saved = resolveTransactionSplit("auto", total, shown, line).split;
        assertEquals(saved.splits, shown.splits, `${total} with line ${line.join(",")}`);
      }
    }
  });
});

// ===========================================================================
// checkSplitSum
// ===========================================================================

describe("checkSplitSum", () => {
  it("accepts the even split Auto mode builds", () => {
    const result = buildEqualSplit(1500, ["a", "b", "c"]);
    assertEquals(
      checkSplitSum(
        1500,
        result.splits.map((s) => s.amount),
      ),
      {
        ok: true,
        difference: 0,
      },
    );
  });

  it("reports what is left to assign (600 of a 1,500 expense)", () => {
    assertEquals(checkSplitSum(1500, [600, 0, 0]), { ok: false, difference: 900 });
  });

  it("reports an over-allocated split as a negative difference", () => {
    assertEquals(checkSplitSum(1500, [800, 800, 0]), { ok: false, difference: -100 });
  });

  it("accepts rounding drift up to the tolerance", () => {
    // 33.33% × 3 of $100 is one cent short.
    assertEquals(checkSplitSum(100, [33.33, 33.33, 33.33]).ok, true);
  });

  it("rejects drift beyond the tolerance", () => {
    // The same percentages on $1,500 leave 15¢ — more than the 6¢ allowed.
    assertEquals(checkSplitSum(1500, [499.95, 499.95, 499.95]).ok, false);
  });

  it("scales the tolerance with the participant count and caps it", () => {
    assertAlmostEquals(splitSumTolerance(1), 0.02, 1e-9);
    assertAlmostEquals(splitSumTolerance(2), 0.04, 1e-9);
    assertAlmostEquals(splitSumTolerance(3), 0.06, 1e-9);
    assertAlmostEquals(splitSumTolerance(5), 0.1, 1e-9);
    assertAlmostEquals(splitSumTolerance(40), 0.1, 1e-9);
  });

  it("flags exactly the splits the server refuses", () => {
    const cases: [number, number[]][] = [
      [1500, [500, 500, 500]],
      [1500, [600, 0, 0]],
      [1500, [700, 700, 100]],
      [100, [33.33, 33.33, 33.33]],
      [1500, [499.95, 499.95, 499.95]],
      [0.05, [0.02, 0.02]],
      [250, [150, 100]],
      [250, [150, 99.95]],
    ];
    for (const [total, amounts] of cases) {
      const form = new FormData();
      form.append("description", "test");
      form.append("amount", total.toString());
      form.append("type", "unico");
      form.append("userPaid", "u0");
      form.append(
        "splitJson",
        JSON.stringify({
          splits: amounts.map((amount, i) => ({
            userId: `u${i}`,
            amount,
            percentage: total > 0 ? (amount / total) * 100 : 0,
          })),
        }),
      );
      assertEquals(
        parseTransactionForm(form).ok,
        checkSplitSum(total, amounts).ok,
        `total ${total}, amounts ${amounts.join(", ")}`,
      );
    }
  });
});

// ===========================================================================
// percentagesFromAmounts
// ===========================================================================

describe("percentagesFromAmounts", () => {
  it("gives three even shares percentages that add up to exactly 100", () => {
    const result = percentagesFromAmounts(1500, equalSplit(["a", "b", "c"], [500, 500, 500]));
    assertEquals(result, { a: 33.34, b: 33.33, c: 33.33 });
  });

  it("leaves the extra where the amounts have it", () => {
    const result = percentagesFromAmounts(100, equalSplit(["a", "b", "c"], [33.33, 33.34, 33.33]));
    assertEquals(result, { a: 33.33, b: 33.34, c: 33.33 });
  });

  it("returns shares that are already exact", () => {
    assertEquals(percentagesFromAmounts(250, equalSplit(["a", "b"], [150, 100])), {
      a: 60,
      b: 40,
    });
    assertEquals(percentagesFromAmounts(960, equalSplit(["a", "b", "c"], [480, 240, 240])), {
      a: 50,
      b: 25,
      c: 25,
    });
  });

  it("keeps a short split short, so the shortfall stays visible", () => {
    const result = percentagesFromAmounts(1500, equalSplit(["a", "b", "c"], [600, 0, 0]));
    assertEquals(result, { a: 40, b: 0, c: 0 });
  });

  it("rounds a short split to the nearest hundredth", () => {
    // 100 of 600 is 16.666…%
    assertEquals(percentagesFromAmounts(600, equalSplit(["a", "b"], [100, 0])), {
      a: 16.67,
      b: 0,
    });
  });

  it("still reaches 100 when the amounts are only within tolerance", () => {
    // 33.32 × 3 = 99.96: four cents short, which the server accepts.
    const short = percentagesFromAmounts(100, equalSplit(["a", "b", "c"], [33.32, 33.32, 33.32]));
    assertEquals(short, { a: 33.34, b: 33.33, c: 33.33 });
    // 33.35 × 3 = 100.05: five cents over, also accepted.
    const over = percentagesFromAmounts(100, equalSplit(["a", "b", "c"], [33.35, 33.35, 33.35]));
    assertEquals(over, { a: 33.33, b: 33.33, c: 33.34 });
  });

  it("returns nothing for a zero total", () => {
    assertEquals(percentagesFromAmounts(0, equalSplit(["a"], [0])), {});
  });

  it("round-trips into a complete split on a new total", () => {
    const percentages = percentagesFromAmounts(1500, equalSplit(["a", "b", "c"], [500, 500, 500]));
    const result = buildPercentageSplit(
      1600,
      Object.entries(percentages).map(([userId, percentage]) => ({ userId, percentage })),
    );
    assertEquals(
      result.splits.map((s) => s.amount),
      [533.44, 533.28, 533.28],
    );
  });
});

// ===========================================================================
// isEqualSplit
// ===========================================================================

describe("isEqualSplit", () => {
  /** A saved split: one entry per (user, amount, percentage). */
  const saved = (entries: [string, number, number][]): SplitEntry[] =>
    entries.map(([userId, amount, percentage]) => ({ userId, amount, percentage }));

  it("recognizes an even split, whichever member got the cent", () => {
    // 1,200.01 over three members: two exact shares and one with the extra cent.
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 400, 33.33],
          ["b", 400, 33.33],
          ["c", 400.01, 33.34],
        ]),
        ["a", "b", "c"],
      ),
      true,
    );
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 400.01, 33.34],
          ["b", 400, 33.33],
          ["c", 400, 33.33],
        ]),
        ["a", "b", "c"],
      ),
      true,
    );
    // 100.01 over three members: two of them carry an extra cent.
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 33.34, 33.34],
          ["b", 33.33, 33.33],
          ["c", 33.34, 33.34],
        ]),
        ["a", "b", "c"],
      ),
      true,
    );
  });

  it("recognizes an even split stored with amounts that add up to 99.99", () => {
    // 33.33% × 3 of $100, saved as such by Porcentaje mode.
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 33.33, 33.33],
          ["b", 33.33, 33.33],
          ["c", 33.33, 33.33],
        ]),
        ["a", "b", "c"],
      ),
      true,
    );
  });

  it("rejects a split that leaves a member out", () => {
    // "Limpieza": 300 / 300 between two of three members.
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 300, 50],
          ["c", 300, 50],
        ]),
        ["a", "b", "c"],
      ),
      false,
    );
  });

  it("rejects custom shares", () => {
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 810, 60],
          ["b", 270, 20],
          ["c", 270, 20],
        ]),
        ["a", "b", "c"],
      ),
      false,
    );
  });

  it("rejects shares more than a cent apart, a duplicated member and a missing one", () => {
    // 400.01 / 400 / 399.99 adds up, but no even split ever hands out 399.99.
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 400.02, 33.33],
          ["b", 400, 33.33],
          ["c", 399.98, 33.33],
        ]),
        ["a", "b", "c"],
      ),
      false,
    );
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 200, 33.33],
          ["a", 200, 33.33],
          ["c", 200, 33.34],
        ]),
        ["a", "b", "c"],
      ),
      false,
    );
    assertEquals(
      isEqualSplit(
        saved([
          ["a", 200, 50],
          ["b", 200, 50],
        ]),
        ["a"],
      ),
      false,
    );
  });
});

// ===========================================================================
// untouchedSplit
// ===========================================================================

describe("untouchedSplit", () => {
  const members = ["a", "b", "c"];
  /** "Limpieza": 600 split between a and c; b is not in it. */
  const limpieza: SplitEntry[] = [
    { userId: "a", amount: 300, percentage: 50 },
    { userId: "c", amount: 300, percentage: 50 },
  ];
  /** "Supermercado": an even 1,200 split. */
  const supermercado: SplitEntry[] = [
    { userId: "a", amount: 400, percentage: 33.33 },
    { userId: "b", amount: 400, percentage: 33.33 },
    { userId: "c", amount: 400, percentage: 33.34 },
  ];
  const form = (
    total: number,
    mode: "auto" | "percentage" | "fixed",
    fixedAmounts: Record<string, number>,
    userIds: string[] = members,
  ) => ({ total, mode, userIds, fixedAmounts });

  it("returns the saved entries while the form shows them in Monto Fijo", () => {
    const result = untouchedSplit(
      { total: 600, splits: limpieza },
      form(600, "fixed", { a: 300, b: 0, c: 300 }),
    );
    assertEquals(result, limpieza);
  });

  it("returns the saved entries in Auto, where a rebuild could move the cent", () => {
    const result = untouchedSplit(
      { total: 1200, splits: supermercado },
      form(1200, "auto", { a: 0, b: 0, c: 0 }),
    );
    assertEquals(result, supermercado);
  });

  it("returns null in Porcentaje, which recomputes from the typed percentages", () => {
    const result = untouchedSplit(
      { total: 1200, splits: supermercado },
      form(1200, "percentage", { a: 400, b: 400, c: 400 }),
    );
    assertEquals(result, null);
  });

  it("returns null in Auto for a split that is not even across every member", () => {
    assertEquals(untouchedSplit({ total: 600, splits: limpieza }, form(600, "auto", {})), null);
  });

  it("returns null once the total changes", () => {
    assertEquals(
      untouchedSplit(
        { total: 600, splits: limpieza },
        form(650, "fixed", { a: 300, b: 0, c: 300 }),
      ),
      null,
    );
  });

  it("returns null once a share changes, and the saved entries when it is restored", () => {
    const saved = { total: 600, splits: limpieza };
    assertEquals(untouchedSplit(saved, form(600, "fixed", { a: 350, b: 0, c: 250 })), null);
    assertEquals(untouchedSplit(saved, form(600, "fixed", { a: 300, b: 50, c: 250 })), null);
    assertEquals(untouchedSplit(saved, form(600, "fixed", { a: 300, b: 0, c: 300 })), limpieza);
  });

  it("returns the saved entries when a member outside the split has left", () => {
    const result = untouchedSplit(
      { total: 600, splits: limpieza },
      form(600, "fixed", { a: 300, c: 300 }, ["a", "c"]),
    );
    assertEquals(result, limpieza);
  });

  it("returns null when a saved member is no longer in the book", () => {
    // c left: the form can no longer show c's 300.
    assertEquals(
      untouchedSplit(
        { total: 600, splits: limpieza },
        form(600, "fixed", { a: 300, b: 0 }, ["a", "b"]),
      ),
      null,
    );
  });
});
