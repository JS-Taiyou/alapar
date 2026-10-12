/**
 * Integer-cents money arithmetic + fair split distribution.
 *
 * The DB stores `NUMERIC(12,2)` (exact decimal), but JavaScript `number` is a
 * float — accumulating floats across many transactions produces the classic
 * `0.1 + 0.2 ≠ 0.3` drift. These helpers perform all money math in integer
 * cents (multiply by 100 → integer arithmetic → divide by 100 at the end),
 * eliminating float intermediaries.
 *
 * The {@link splitCents} function distributes a total as evenly as possible:
 * everyone gets `floor(total / n)`, and the remainder (0..n-1 cents) goes one
 * cent each to `r` members starting at a deterministic offset. This guarantees:
 *   1. **Sum invariant**: shares always sum exactly to the total.
 *   2. **Determinism**: the same seed always distributes the same way.
 *   3. **Fairness**: over many transactions, every member receives roughly
 *      equal extra cents (no user systematically bears the rounding burden).
 */

/** Convert dollars → integer cents. Uses Math.round to handle float input. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Convert integer cents → dollars. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Distribute `totalCents` among `memberIds` as evenly as possible.
 *
 * @param totalCents the total amount in integer cents
 * @param memberIds  the members to split among (order matters for the offset)
 * @param seed       a stable string (e.g. transaction UUID) that determines
 *                   which members get the extra cent — same seed = same split
 * @returns a Map of `userId → cents` (always sums exactly to `totalCents`)
 */
export function splitCents(
  totalCents: number,
  memberIds: string[],
  seed: string,
): Map<string, number> {
  const n = memberIds.length;
  if (n === 0) return new Map();
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n; // always in range 0 .. n-1
  const offset = hashToIndex(seed, n);
  const result = new Map<string, number>();
  memberIds.forEach((id, i) => {
    const getsExtra = ((i - offset + n) % n) < remainder;
    result.set(id, base + (getsExtra ? 1 : 0));
  });
  return result;
}

/**
 * Stable string hash → index in `[0, n)`. Not cryptographic — used only for
 * fairness/determinism in remainder distribution.
 */
function hashToIndex(seed: string, n: number): number {
  let h = 0;
  for (const c of seed) {
    h = (h * 31 + c.charCodeAt(0)) >>> 0;
  }
  return n > 0 ? h % n : 0;
}
