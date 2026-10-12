import { assert, assertEquals, describe, it } from "@test/compat";
import { fromCents, splitCents, toCents } from "./splits";

// ===========================================================================
// toCents / fromCents
// ===========================================================================

describe("toCents", () => {
  it("converts whole dollars to cents", () => {
    assertEquals(toCents(100), 10000);
    assertEquals(toCents(1), 100);
  });

  it("converts fractional dollars correctly", () => {
    assertEquals(toCents(99.99), 9999);
    assertEquals(toCents(0.01), 1);
  });

  it("handles the float imprecision edge case (0.1 + 0.2)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in float, but toCents should round to 30
    assertEquals(toCents(0.1 + 0.2), 30);
  });
});

describe("fromCents", () => {
  it("converts cents to dollars", () => {
    assertEquals(fromCents(10000), 100);
    assertEquals(fromCents(99), 0.99);
  });
});

// ===========================================================================
// splitCents — sum invariant (the critical property)
// ===========================================================================

describe("splitCents — sum invariant", () => {
  it("shares always sum exactly to the total (tested over many cases)", () => {
    for (let total = 0; total <= 50000; total += 7) {
      for (const n of [1, 2, 3, 4, 5, 7, 13]) {
        const ids = Array.from({ length: n }, (_, i) => `u${i}`);
        const result = splitCents(total, ids, `seed-${total}-${n}`);
        const sum = [...result.values()].reduce((a, b) => a + b, 0);
        assertEquals(
          sum,
          total,
          `splitCents(${total}, ${n} members) summed to ${sum}, expected ${total}`,
        );
      }
    }
  });

  it("100/7: shares sum to exactly 10000 cents", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const result = splitCents(10000, ids, "tx-001");
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    assertEquals(sum, 10000);
    // 10000 / 7 = 1428 remainder 4 → 4 members get 1429, 3 get 1428
    const vals = [...result.values()].sort((a, b) => b - a);
    assertEquals(vals[0], 1429);
    assertEquals(vals[3], 1429);
    assertEquals(vals[4], 1428);
    assertEquals(vals[6], 1428);
  });
});

// ===========================================================================
// splitCents — determinism
// ===========================================================================

describe("splitCents — determinism", () => {
  it("same seed always produces the same distribution", () => {
    const ids = ["a", "b", "c", "d"];
    const r1 = splitCents(10033, ids, "tx-001");
    const r2 = splitCents(10033, ids, "tx-001");
    assertEquals(r1, r2);
  });

  it("different seeds may produce different distributions (fairness)", () => {
    const ids = ["a", "b", "c"];
    // 100 cents / 3 = 33 remainder 1 → one member gets 34
    const r1 = splitCents(100, ids, "seed-A");
    const r2 = splitCents(100, ids, "seed-B");
    // At least one of these should give the extra cent to a different member
    // (not guaranteed for every pair of seeds, but likely for these)
    const extra1 = [...r1.entries()].find(([, v]) => v === 34)?.[0];
    const extra2 = [...r2.entries()].find(([, v]) => v === 34)?.[0];
    // We can't guarantee they differ, but we CAN guarantee each is valid
    assert(extra1, "seed-A should have one member getting 34");
    assert(extra2, "seed-B should have one member getting 34");
  });
});

// ===========================================================================
// splitCents — fairness (over many seeds, extra cents distribute evenly)
// ===========================================================================

describe("splitCents — fairness", () => {
  it("over 1000 transactions, extra cents distribute roughly evenly", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    // 10000 / 7 = 1428 remainder 4 → 4 members get +1 each per transaction
    const extraCounts: Record<string, number> = {};
    for (const id of ids) extraCounts[id] = 0;

    for (let i = 0; i < 1000; i++) {
      const result = splitCents(10000, ids, `tx-${i}`);
      for (const [id, cents] of result) {
        if (cents === 1429) extraCounts[id]++;
      }
    }

    // Each member should get the extra cent roughly 1000 * 4/7 ≈ 571 times.
    // Check no member is systematically starved or overfed.
    const counts = Object.values(extraCounts);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    // Allow generous variance but catch systematic bias (e.g. user[0] always gets it)
    assert(max - min < 150, `Unfair distribution: ${JSON.stringify(extraCounts)}`);
  });
});

// ===========================================================================
// splitCents — edge cases
// ===========================================================================

describe("splitCents — edge cases", () => {
  it("handles a single member (all goes to them)", () => {
    const result = splitCents(500, ["solo"], "seed");
    assertEquals(result.get("solo"), 500);
  });

  it("handles zero total", () => {
    const result = splitCents(0, ["a", "b", "c"], "seed");
    assertEquals([...result.values()], [0, 0, 0]);
  });

  it("handles empty member list", () => {
    const result = splitCents(100, [], "seed");
    assertEquals(result.size, 0);
  });

  it("handles exact division (no remainder)", () => {
    const result = splitCents(600, ["a", "b", "c"], "seed");
    assertEquals([...result.values()], [200, 200, 200]);
  });
});
