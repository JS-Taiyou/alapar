import { assertEquals, describe, it } from "@test/compat";
import { advanceLine, fromCents, lineOrder, resolveCents, splitCents, toCents } from "./splits";

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

const even = (ids: string[]) => ids.map((userId) => ({ userId, weight: 1 }));
const at = (ids: string[], cents: number[]) =>
  Object.fromEntries(ids.map((id, i) => [id, cents[i]]));

// ===========================================================================
// resolveCents — whole cents that add up (the invariant that keeps money)
// ===========================================================================

describe("resolveCents — whole cents that add up", () => {
  it("shares always sum exactly to the total (tested over many cases)", () => {
    for (let total = 0; total <= 50000; total += 7) {
      for (const n of [1, 2, 3, 4, 5, 7, 13]) {
        const ids = Array.from({ length: n }, (_, i) => `u${i}`);
        const { cents } = resolveCents(total, even(ids), n, []);
        const sum = cents.reduce((a, b) => a + b, 0);
        assertEquals(sum, total, `resolveCents(${total}, ${n} members) summed to ${sum}`);
      }
    }
  });

  it("never leaves a fraction of a cent, for even shares or percentages", () => {
    for (let total = 1; total <= 3000; total += 3) {
      for (const n of [2, 3, 6, 7]) {
        const ids = Array.from({ length: n }, (_, i) => `u${i}`);
        for (const weight of [1, 100 / n, 6000 / n, 1234]) {
          const { cents } = resolveCents(
            total,
            ids.map((userId) => ({ userId, weight })),
            weight === 1 ? n : 10000,
            [],
          );
          for (const share of cents) assertEquals(Number.isInteger(share), true);
          assertEquals(
            cents.reduce((a, b) => a + b, 0),
            total,
          );
        }
      }
    }
  });

  it("100/7: shares sum to exactly 10000 cents", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const { cents } = resolveCents(10000, even(ids), 7, []);
    assertEquals(
      cents.reduce((a, b) => a + b, 0),
      10000,
    );
    // 10000 / 7 = 1428 remainder 4 → 4 members get 1429, 3 get 1428
    const sorted = [...cents].sort((a, b) => b - a);
    assertEquals(sorted[0], 1429);
    assertEquals(sorted[3], 1429);
    assertEquals(sorted[4], 1428);
    assertEquals(sorted[6], 1428);
  });

  it("rounds each share down and gives the leftover cents to the largest remainders", () => {
    const shares = [
      { userId: "a", weight: 60 },
      { userId: "b", weight: 40 },
    ];
    // 60/40 of $10.01: 6.006 and 4.004 → 6.00 + 4.00, and the cent to the .006.
    assertEquals(at(["a", "b"], resolveCents(1001, shares, 100, []).cents), { a: 601, b: 400 });
    // $10.02: 6.012 and 4.008 → 6.01 + 4.00, and the cent to the .008.
    assertEquals(at(["a", "b"], resolveCents(1002, shares, 100, []).cents), { a: 601, b: 401 });
  });

  it("gives a cent the percentages decide to that member, and settles only the rest by the line", () => {
    // 33.34 / 33.33 / 33.33 of $20.00: 6.668, 6.666, 6.666 → 6.66 each and two
    // cents over. One is the .668's by remainder; the other is a tie between
    // b and c, and b is first in line.
    const shares = [
      { userId: "a", weight: 3334 },
      { userId: "b", weight: 3333 },
      { userId: "c", weight: 3333 },
    ];
    const dealt = resolveCents(2000, shares, 10000, ["b", "a", "c"]);
    assertEquals(at(["a", "b", "c"], dealt.cents), { a: 667, b: 667, c: 666 });
    assertEquals(dealt.absorbed, ["a", "b"]);
    assertEquals(dealt.queue, ["c", "a", "b"]);
  });

  it("takes cents back from the smallest remainders when the floors add up to too much", () => {
    // 60.02 / 40.01 of $100.01 → 60.026 and 40.014: floors 60.02 + 40.01 are
    // two cents over. The smaller remainder gives one back first.
    const shares = [
      { userId: "a", weight: 6002 },
      { userId: "b", weight: 4001 },
    ];
    const dealt = resolveCents(10001, shares, 10000, []);
    assertEquals(at(["a", "b"], dealt.cents), { a: 6001, b: 4000 });
    assertEquals(dealt.absorbed, ["b", "a"]);
  });

  it("deals in rounds when the shares miss the total by more than a cent each", () => {
    // 33.34 × 3 of $500.00: floors 166.70 each are $0.10 over. Ten cents come
    // back around the line, so nobody gives back more than anyone else.
    const shares = [
      { userId: "a", weight: 3334 },
      { userId: "b", weight: 3334 },
      { userId: "c", weight: 3334 },
    ];
    const dealt = resolveCents(50000, shares, 10000, []);
    assertEquals(dealt.cents, [16666, 16667, 16667]);
    assertEquals(
      dealt.cents.reduce((a, b) => a + b, 0),
      50000,
    );
    assertEquals(dealt.absorbed, ["a", "b", "c"]);
  });

  it("matches exact integer arithmetic on amounts near the app's ceiling", () => {
    // $99,999,999.99 is 9,999,999,999 cents; times a percentage in hundredths
    // it is still an exact integer, but the division to find its floor is not.
    const total = toCents(99_999_999.99);
    for (const weight of [1, 10, 1000, 1667, 3334, 5001, 9000, 9999]) {
      const product = BigInt(total) * BigInt(weight);
      const floor = Number(product / 10000n);
      const [cents] = resolveCents(
        total,
        [
          { userId: "a", weight },
          { userId: "b", weight: 10000 - weight },
        ],
        10000,
        [],
      ).cents;
      // a gets its floor, plus a cent only if one is left over for it.
      assertEquals(cents === floor || cents === floor + 1, true, `weight ${weight}`);
    }
  });
});

// ===========================================================================
// resolveCents — the book's line
// ===========================================================================

describe("resolveCents — the book's line", () => {
  it("50/50 of $10.11 alternates: 5.05 / 5.06, then 5.06 / 5.05", () => {
    const ids = ["x", "y"];
    const first = resolveCents(1011, even(ids), 2, []);
    assertEquals(at(ids, first.cents), { x: 506, y: 505 });
    assertEquals(first.absorbed, ["x"]);
    assertEquals(first.queue, ["x"]);
    const second = resolveCents(1011, even(ids), 2, first.queue);
    assertEquals(at(ids, second.cents), { x: 505, y: 506 });
    assertEquals(second.queue, ["x", "y"]);
    const third = resolveCents(1011, even(ids), 2, second.queue);
    assertEquals(at(ids, third.cents), { x: 506, y: 505 });
    assertEquals(third.queue, ["y", "x"]);
  });

  it("among n members, whoever took a cent waits exactly n − 1 turns", () => {
    // $4.21 leaves exactly one cent over for 2, 3, 5, 7 and 12 members alike.
    for (const n of [2, 3, 5, 7, 12]) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      let queue: string[] = [];
      const turns: string[] = [];
      for (let i = 0; i < n * 4; i++) {
        const dealt = resolveCents(421, even(ids), n, queue);
        assertEquals(dealt.absorbed.length, 1, `n=${n}, expense ${i}`);
        turns.push(dealt.absorbed[0]);
        queue = dealt.queue;
      }
      // Everyone gets a first turn before anyone gets a second, and the order
      // then repeats for good.
      const cycle = turns.slice(0, n);
      assertEquals(new Set(cycle).size, n, `n=${n}: the first ${n} turns cover every member`);
      for (let i = 0; i < turns.length; i++) {
        assertEquals(turns[i], cycle[i % n], `n=${n}, turn ${i}`);
      }
    }
  });

  it("two leftover cents go to the first two in line, and both take a turn", () => {
    // $10.01 among three: 3.33 each leaves two cents.
    const ids = ["a", "b", "c"];
    const first = resolveCents(1001, even(ids), 3, []);
    assertEquals(at(ids, first.cents), { a: 334, b: 334, c: 333 });
    assertEquals(first.queue, ["a", "b"]);
    const second = resolveCents(1001, even(ids), 3, first.queue);
    assertEquals(at(ids, second.cents), { a: 334, b: 333, c: 334 });
    assertEquals(second.queue, ["b", "c", "a"]);
    // Each member carries a cent in two of every three such expenses.
    const count: Record<string, number> = { a: 0, b: 0, c: 0 };
    let queue: string[] = [];
    for (let i = 0; i < 30; i++) {
      const dealt = resolveCents(1001, even(ids), 3, queue);
      for (const id of dealt.absorbed) count[id]++;
      queue = dealt.queue;
    }
    assertEquals(count, { a: 20, b: 20, c: 20 });
  });

  it("leaves the line alone when nothing is left over", () => {
    const queue = ["b", "a"];
    const dealt = resolveCents(1000, even(["a", "b"]), 2, queue);
    assertEquals(dealt.cents, [500, 500]);
    assertEquals(dealt.absorbed, []);
    assertEquals(dealt.queue, ["b", "a"]);
  });

  it("skips members who are not in the expense without losing their place", () => {
    // A four-member book where only a and c share this one.
    let queue = ["a", "b", "c", "d"];
    for (const expected of ["a", "c", "a", "c", "a"]) {
      const dealt = resolveCents(1011, even(["a", "c"]), 2, queue);
      assertEquals(dealt.absorbed, [expected]);
      assertEquals(
        dealt.queue.filter((id) => id === "b" || id === "d"),
        ["b", "d"],
      );
      queue = dealt.queue;
    }
  });

  it("a member who never took a cent goes before anyone who did", () => {
    // a and b have been alternating; c joins the book.
    let queue = resolveCents(1003, even(["a", "b"]), 2, []).queue;
    queue = resolveCents(1003, even(["a", "b"]), 2, queue).queue;
    assertEquals(queue, ["a", "b"]);
    // c takes the very next cent, before either of them gets another.
    const joined = resolveCents(1003, even(["a", "b", "c"]), 3, queue);
    assertEquals(joined.absorbed, ["c"]);
    assertEquals(joined.queue, ["a", "b", "c"]);
    // From then on the three of them take turns.
    queue = joined.queue;
    const turns: string[] = [];
    for (let i = 0; i < 6; i++) {
      const dealt = resolveCents(1003, even(["a", "b", "c"]), 3, queue);
      turns.push(...dealt.absorbed);
      queue = dealt.queue;
    }
    assertEquals(turns, ["a", "b", "c", "a", "b", "c"]);
  });

  it("gives the same result for the same line, whatever came before it", () => {
    const ids = ["a", "b", "c", "d"];
    const queue = ["c", "a", "d", "b"];
    const one = resolveCents(1011, even(ids), 4, queue);
    assertEquals(one, resolveCents(1011, even(ids), 4, [...queue]));
    // Nor does the order the split lists its members in, once all are in line.
    const reversed = [...ids].reverse();
    const reordered = resolveCents(1011, even(reversed), 4, queue);
    assertEquals(at(reversed, reordered.cents), at(ids, one.cents));
    assertEquals(reordered.queue, one.queue);
    assertEquals(one.queue, ["b", "c", "a", "d"]);
  });

  it("in a tie, the line decides even when the split lists members in another order", () => {
    const dealt = resolveCents(1011, even(["x", "y"]), 2, ["y", "x"]);
    assertEquals(dealt.absorbed, ["y"]);
    assertEquals(dealt.queue, ["x", "y"]);
  });
});

// ===========================================================================
// lineOrder / advanceLine
// ===========================================================================

describe("lineOrder", () => {
  it("puts members the line has never seen first, then the line, front first", () => {
    assertEquals(lineOrder(["c", "a", "d", "b"], ["b", "x", "a"]), ["c", "d", "b", "a"]);
  });
});

describe("advanceLine", () => {
  it("moves whoever took a turn to the back, in the order served", () => {
    assertEquals(advanceLine(["a", "b", "c", "d"], ["b", "a"]), ["c", "d", "b", "a"]);
  });

  it("does not repeat a member who took two turns", () => {
    assertEquals(advanceLine(["a", "b"], ["a", "a"]), ["b", "a"]);
  });
});

// ===========================================================================
// splitCents — the even-split wrapper
// ===========================================================================

describe("splitCents", () => {
  it("sums exactly to the total and follows the line", () => {
    const ids = ["a", "b", "c"];
    // $10.01 among three leaves one cent, and c is first in line.
    const result = splitCents(1001, ids, ["c", "b", "a"]);
    assertEquals(
      [...result.values()].reduce((a, b) => a + b, 0),
      1001,
    );
    assertEquals(result.get("c"), 334);
    assertEquals(result.get("a"), 333);
  });

  it("handles a single member, zero, none and an exact division", () => {
    assertEquals(splitCents(500, ["solo"]).get("solo"), 500);
    assertEquals([...splitCents(0, ["a", "b", "c"]).values()], [0, 0, 0]);
    assertEquals(splitCents(100, []).size, 0);
    assertEquals([...splitCents(600, ["a", "b", "c"]).values()], [200, 200, 200]);
  });
});
