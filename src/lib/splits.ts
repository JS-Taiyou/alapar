/**
 * Integer-cents money arithmetic + the book's line for leftover cents.
 *
 * The DB stores `NUMERIC(12,2)` (exact decimal), but JavaScript `number` is a
 * float — accumulating floats across many transactions produces the classic
 * `0.1 + 0.2 ≠ 0.3` drift. These helpers perform all money math in integer
 * cents (multiply by 100 → integer arithmetic → divide by 100 at the end),
 * eliminating float intermediaries.
 *
 * A cent cannot be divided, and the app never keeps fractions of one.
 * {@link resolveCents} gives everyone the floor of their exact share and hands
 * the leftover cents to the largest remainders; where that is a tie (an even
 * split, 50/50) the book's line decides, and whoever took a cent moves to the
 * back of it. So:
 *   1. **Sum invariant**: shares always sum exactly to the total.
 *   2. **Whole cents**: no share is ever a fraction of a cent.
 *   3. **Fairness**: among n members, whoever took a cent waits n − 1 turns,
 *      in an order the book keeps for good.
 */

/** Convert dollars → integer cents. Uses Math.round to handle float input. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Convert integer cents → dollars. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** A share of a total, exactly: `total × weight / divisor`. */
export interface ExactShare {
  userId: string;
  weight: number;
}

export interface RemainderResolution {
  /** Whole cents per share, in the order the shares were given. */
  cents: number[];
  /** Who took a leftover cent (or gave one back), first served first. */
  absorbed: string[];
  /** The line once this split is done. */
  queue: string[];
}

/**
 * The order ties are settled in: members the line has never seen go first
 * (in split order — everyone gets a first turn before anyone gets a second),
 * then whoever is in the line, front first.
 */
export function lineOrder(ids: readonly string[], queue: readonly string[]): string[] {
  return [...ids.filter((id) => !queue.includes(id)), ...queue.filter((id) => ids.includes(id))];
}

/** The line once `moved` have taken their turn: they wait at the back, in the order served. */
export function advanceLine(queue: readonly string[], moved: readonly string[]): string[] {
  const back = [...new Set(moved)];
  const taken = new Set(back);
  return [...queue.filter((id) => !taken.has(id)), ...back];
}

/**
 * Resolve exact shares to whole cents against the book's line.
 *
 * Each share is rounded down. The cents left over go one at a time to the
 * largest remainders — or, when the floors add up to more than the total, the
 * smallest remainders give one back. A tie is settled by the line. Whoever
 * gained or lost a cent that way takes a turn and moves to the back.
 *
 * @param totalCents the total, in integer cents
 * @param shares     who gets what: `weight / divisor` of the total each
 * @param queue      the book's line, front first
 */
export function resolveCents(
  totalCents: number,
  shares: readonly ExactShare[],
  divisor: number,
  queue: readonly string[],
): RemainderResolution {
  const ids = shares.map((share) => share.userId);
  const n = ids.length;
  if (n === 0 || divisor <= 0) return { cents: [], absorbed: [], queue: [...queue] };

  const line = lineOrder(ids, queue);
  const turn = new Map(line.map((id, i) => [id, i]));

  // Floor and remainder of each exact share, in integer arithmetic. The
  // division itself is float, so the remainder corrects it by one if a share
  // this size ever lands within rounding distance of a whole cent.
  const cents: number[] = [];
  const remainders: number[] = [];
  for (const share of shares) {
    const product = totalCents * share.weight;
    let floor = Math.floor(product / divisor);
    let remainder = product - floor * divisor;
    if (remainder < 0) {
      floor -= 1;
      remainder += divisor;
    } else if (remainder >= divisor) {
      floor += 1;
      remainder -= divisor;
    }
    cents.push(floor);
    remainders.push(remainder);
  }

  const leftover = totalCents - cents.reduce((sum, value) => sum + value, 0);
  let absorbed: string[] = [];
  if (leftover !== 0) {
    const sign = leftover > 0 ? 1 : -1;
    const order = ids
      .map((_, i) => i)
      .sort(
        (a, b) =>
          sign * (remainders[b] - remainders[a]) ||
          (turn.get(ids[a]) ?? 0) - (turn.get(ids[b]) ?? 0),
      );
    // Shares that miss the total by more than a cent each are dealt in
    // rounds; each round is the same order again.
    const steps = Math.abs(leftover);
    const rounds = Math.floor(steps / n);
    const served = order.slice(0, steps % n);
    for (let i = 0; i < n; i++) cents[i] += sign * rounds;
    for (const i of served) cents[i] += sign;
    absorbed = [...new Set((rounds > 0 ? [...order, ...served] : served).map((i) => ids[i]))];
  }

  return { cents, absorbed, queue: advanceLine(queue, absorbed) };
}

/**
 * Divide `totalCents` as evenly as possible among `memberIds`, in whole cents.
 *
 * @param queue the book's line: whoever took the last leftover cent is last
 * @returns a Map of `userId → cents` (always sums exactly to `totalCents`)
 */
export function splitCents(
  totalCents: number,
  memberIds: string[],
  queue: readonly string[] = [],
): Map<string, number> {
  const { cents } = resolveCents(
    totalCents,
    memberIds.map((userId) => ({ userId, weight: 1 })),
    memberIds.length,
    queue,
  );
  return new Map(memberIds.map((id, i) => [id, cents[i]]));
}
