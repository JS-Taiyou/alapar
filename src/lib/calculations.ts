import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  SplitEntry,
  SplitMode,
  Transaction,
  TransactionSplit,
} from "./types";
import { advanceLine, fromCents, lineOrder, resolveCents, splitCents, toCents } from "./splits";

export function calculateBalance(transactions: Transaction[], userId: string): number {
  let balance = 0;
  for (const tx of transactions) {
    if (tx.type === "pago" || tx.type === "ajuste") {
      if (tx.userPaid === userId) {
        balance += tx.originalAmount;
      } else {
        const isInSplit = tx.splitJson.splits.some((s) => s.userId === userId);
        if (isInSplit) balance -= tx.originalAmount;
      }
      continue;
    }
    const userSplit = tx.splitJson.splits.find((s) => s.userId === userId);
    if (!userSplit) continue;
    const divisor = tx.type === "parcialidad" && tx.installmentTotal ? tx.installmentTotal : 1;
    const totalAmount = tx.originalAmount / divisor;
    const splitAmount = userSplit.amount / divisor;
    if (tx.userPaid === userId) {
      balance += totalAmount - splitAmount;
    } else {
      balance -= splitAmount;
    }
  }
  return balance;
}

export function calculatePairwiseBreakdown(
  transactions: Transaction[],
  currentUserId: string,
  allParticipants: Participant[],
): BalanceBreakdownEntry[] {
  const net: Record<string, number> = {};
  for (const u of allParticipants) {
    if (u.id !== currentUserId) net[u.id] = 0;
  }

  for (const tx of transactions) {
    if (tx.type === "pago" || tx.type === "ajuste") {
      if (tx.userPaid === currentUserId) {
        const recipient = tx.splitJson.splits[0];
        if (recipient && net[recipient.userId] !== undefined) {
          net[recipient.userId] += tx.originalAmount;
        }
      } else if (tx.splitJson.splits.some((s) => s.userId === currentUserId)) {
        if (net[tx.userPaid] !== undefined) {
          net[tx.userPaid] -= tx.originalAmount;
        }
      }
      continue;
    }

    const divisor = tx.type === "parcialidad" && tx.installmentTotal ? tx.installmentTotal : 1;
    const currentUserSplit = tx.splitJson.splits.find((s) => s.userId === currentUserId);
    if (!currentUserSplit) continue;

    if (tx.userPaid === currentUserId) {
      for (const split of tx.splitJson.splits) {
        if (split.userId !== currentUserId && net[split.userId] !== undefined) {
          net[split.userId] += split.amount / divisor;
        }
      }
    } else {
      if (net[tx.userPaid] !== undefined) {
        net[tx.userPaid] -= currentUserSplit.amount / divisor;
      }
    }
  }

  const entries: BalanceBreakdownEntry[] = [];
  for (const u of allParticipants) {
    if (u.id === currentUserId) continue;
    const amount = Math.round((net[u.id] ?? 0) * 100) / 100;
    if (Math.abs(amount) >= 0.01) {
      entries.push({
        userId: u.id,
        userName: u.name,
        userColor: u.color,
        amount,
      });
    }
  }

  entries.sort((a, b) => b.amount - a.amount);
  return entries;
}

export interface PairwiseDebt {
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  amount: number;
}

export function calculateFullPairwiseBalances(
  transactions: Transaction[],
  allParticipants: Participant[],
): PairwiseDebt[] {
  const userIds = allParticipants.map((u) => u.id);
  const userMap = new Map(allParticipants.map((u) => [u.id, u]));

  const net: Record<string, Record<string, number>> = {};
  for (const a of userIds) {
    net[a] = {};
    for (const b of userIds) {
      if (a !== b) net[a][b] = 0;
    }
  }

  for (const tx of transactions) {
    if (tx.type === "pago" || tx.type === "ajuste") {
      const recipient = tx.splitJson.splits[0];
      if (recipient && net[tx.userPaid]?.[recipient.userId] !== undefined) {
        net[tx.userPaid][recipient.userId] += tx.originalAmount;
      }
      continue;
    }

    const divisor = tx.type === "parcialidad" && tx.installmentTotal ? tx.installmentTotal : 1;

    for (const split of tx.splitJson.splits) {
      if (split.userId !== tx.userPaid) {
        if (net[tx.userPaid]?.[split.userId] !== undefined) {
          net[tx.userPaid][split.userId] += split.amount / divisor;
        }
      }
    }
  }

  const debts: PairwiseDebt[] = [];
  for (let i = 0; i < userIds.length; i++) {
    for (let j = i + 1; j < userIds.length; j++) {
      const a = userIds[i];
      const b = userIds[j];
      const netAmount = Math.round(((net[a][b] ?? 0) - (net[b][a] ?? 0)) * 100) / 100;
      if (Math.abs(netAmount) < 0.01) continue;

      if (netAmount > 0) {
        debts.push({
          fromUserId: b,
          fromUserName: userMap.get(b)?.name ?? b,
          toUserId: a,
          toUserName: userMap.get(a)?.name ?? a,
          amount: netAmount,
        });
      } else {
        debts.push({
          fromUserId: a,
          fromUserName: userMap.get(a)?.name ?? a,
          toUserId: b,
          toUserName: userMap.get(b)?.name ?? b,
          amount: Math.abs(netAmount),
        });
      }
    }
  }

  return debts;
}

/**
 * Even percentages that add up to exactly 100: 100% is divided the way
 * {@link buildEqualSplit} divides a total, so the rounding remainder lands on
 * one member instead of vanishing (three members get 33.34 / 33.33 / 33.33,
 * not 33.33 × 3 = 99.99, which left $0.15 of a $1,500 expense unassigned).
 * The odd hundredth goes to whoever is first in the book's line.
 *
 * @param line the book's line for indivisible units, front first
 */
export function equalPercentages(
  userIds: string[],
  line: readonly string[] = [],
): Record<string, number> {
  return Object.fromEntries(
    [...splitCents(10000, userIds, line)].map(([userId, cents]) => [userId, fromCents(cents)]),
  );
}

/**
 * Whether percentages are an even split written with two decimals: each one
 * is `100 / n` rounded, give or take the odd hundredth of a percent that has
 * to land somewhere (33.34 among 33.33s).
 */
export function isEvenPercentages(percentages: Record<string, number>): boolean {
  const units = Object.values(percentages).map((p) => Math.round(p * 100));
  const base = Math.floor(10000 / units.length);
  return units.length >= 2 && units.every((unit) => unit === base || unit === base + 1);
}

/**
 * Percentages as stored, completed to exactly 100 when they miss it only by a
 * rounding residue. An even three-way split used to be saved as 33.33 × 3 =
 * 99.99, which leaves $0.15 of a $1,500 expense unassigned — more than the
 * server's slack. The residue goes to the first entry; anything further off is
 * the user's own unfinished input and is left alone.
 */
export function completePercentages(percentages: Record<string, number>): Record<string, number> {
  const entries = Object.entries(percentages);
  const residue = Math.round((100 - entries.reduce((sum, [, p]) => sum + p, 0)) * 100) / 100;
  // At most half a cent of a percent lost per entry counts as rounding.
  if (entries.length === 0 || residue === 0 || Math.abs(residue) > 0.005 * entries.length) {
    return percentages;
  }
  const [first, ...rest] = entries;
  return Object.fromEntries([[first[0], Math.round((first[1] + residue) * 100) / 100], ...rest]);
}

export function computeDefaultPercentages(
  participants: Participant[],
  defaultSplit: DefaultSplit | null,
  line: readonly string[] = [],
): Record<string, number> {
  if (defaultSplit && defaultSplit.splits.length === participants.length) {
    const userIds = new Set(participants.map((u) => u.id));
    if (defaultSplit.splits.every((s) => userIds.has(s.userId))) {
      const stored = Object.fromEntries(defaultSplit.splits.map((s) => [s.userId, s.percentage]));
      // An even default is dealt by the line every time: its odd hundredth of
      // a percent must not stay with the member it was saved on.
      if (!isEvenPercentages(stored)) return completePercentages(stored);
    }
  }
  return equalPercentages(
    participants.map((u) => u.id),
    line,
  );
}

export function buildEqualSplit(
  total: number,
  userIds: string[],
  line: readonly string[] = [],
): TransactionSplit {
  const cents = splitCents(toCents(total), userIds, line);
  const count = userIds.length;
  const splits: SplitEntry[] = userIds.map((uid) => ({
    userId: uid,
    percentage: Math.round((100 / count) * 100) / 100,
    amount: fromCents(cents.get(uid) ?? 0),
  }));
  return { splits };
}

export function buildPercentageSplit(
  total: number,
  percentages: { userId: string; percentage: number }[],
): TransactionSplit {
  const totalCents = toCents(total);
  const splits: SplitEntry[] = percentages.map((p) => ({
    userId: p.userId,
    percentage: p.percentage,
    amount: fromCents(Math.round((totalCents * p.percentage) / 100)),
  }));
  return { splits };
}

/**
 * Whether two splits hand every member the same cents, in the same order.
 */
export function sameSplitCents(a: SplitEntry[], b: SplitEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (split, i) => split.userId === b[i].userId && toCents(split.amount) === toCents(b[i].amount),
    )
  );
}

/** Members holding the odd hundredth of a percent of an even split; none when the percentages are anything else. */
function evenResidueHolders(units: number[]): number[] {
  const n = units.length;
  const base = Math.floor(10000 / n);
  if (n < 2 || units.reduce((sum, unit) => sum + unit, 0) !== 10000) return [];
  if (!units.every((unit) => unit === base || unit === base + 1)) return [];
  return units.flatMap((unit, i) => (unit === base + 1 ? [i] : []));
}

/**
 * The split a transaction is saved with.
 *
 * Auto and Porcentaje have their shares dealt to whole cents against the
 * book's line (see `resolveCents`): what the form sent is only a prediction,
 * and may miss the total by a few cents of rounding. Monto Fijo is the user's
 * own cents and is kept as typed. Without a mode — an older client, or a
 * payment — the split is kept exactly as sent.
 *
 * Whoever holds the odd hundredth of a percent of an even split takes a turn
 * as well, even on an amount where every share comes out exact: 33.34% is a
 * share above even, just as a leftover cent is (it is $0.15 more of $1,500).
 *
 * @param line the book's line, front first
 * @returns the split to save; `took`, the members who took a turn; and the
 *   line once this one is dealt
 */
export function resolveTransactionSplit(
  mode: SplitMode | undefined,
  total: number,
  sent: TransactionSplit,
  line: readonly string[],
): { split: TransactionSplit; took: string[]; line: string[] } {
  const { splits } = sent;
  if (!mode) return { split: sent, took: [], line: [...line] };
  if (mode === "fixed" || splits.length === 0) {
    return { split: { splits, mode }, took: [], line: [...line] };
  }

  const byPercentage = mode === "percentage";
  const units = splits.map((split) => Math.round(split.percentage * 100));
  const dealt = resolveCents(
    toCents(total),
    splits.map((split, i) => ({ userId: split.userId, weight: byPercentage ? units[i] : 1 })),
    byPercentage ? 10000 : splits.length,
    line,
  );

  const took = new Set(dealt.absorbed);
  if (byPercentage) {
    for (const i of evenResidueHolders(units)) took.add(splits[i].userId);
  }
  // First in line first: that is the order they wait at the back in.
  const order = lineOrder(
    splits.map((split) => split.userId),
    line,
  );
  const turns = [...took].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return {
    split: {
      mode,
      splits: splits.map((split, i) => ({
        userId: split.userId,
        percentage: split.percentage,
        amount: fromCents(dealt.cents[i]),
      })),
    },
    took: turns,
    line: advanceLine(line, turns),
  };
}

export function buildFixedSplit(
  total: number,
  amounts: { userId: string; amount: number }[],
): TransactionSplit {
  const totalCents = toCents(total);
  const splits: SplitEntry[] = amounts.map((a) => ({
    userId: a.userId,
    percentage: totalCents > 0 ? Math.round((toCents(a.amount) / totalCents) * 10000) / 100 : 0,
    amount: a.amount,
  }));
  return { splits };
}

export interface SplitSumCheck {
  /** Whether the server accepts the split: its amounts account for the total. */
  ok: boolean;
  /**
   * The total minus the sum of the amounts: positive when part of the total
   * is unassigned, negative when the split adds up to more than the total.
   */
  difference: number;
}

/**
 * How far split amounts may drift from the expense total before the
 * transaction is rejected. Mirrors `splitSumTolerance` in
 * transaction-validation.ts — the form must flag exactly what the server
 * refuses, no more and no less.
 */
export function splitSumTolerance(splitCount: number): number {
  return Math.max(0.02, Math.min(0.1, 0.02 * splitCount));
}

/**
 * Check an expense split the way the server does: on the resulting AMOUNTS
 * against the total, never on the (rounded) percentages they came from.
 */
export function checkSplitSum(total: number, amounts: number[]): SplitSumCheck {
  const sum = amounts.reduce((s, a) => s + a, 0);
  return {
    ok: Math.abs(sum - total) <= splitSumTolerance(amounts.length),
    difference: total - sum,
  };
}

/**
 * Percentages (two decimals) that reproduce `amounts`. When the amounts
 * account for the whole total the percentages are made to add up to exactly
 * 100 — the rounding residue goes to the shares that lost the most — so
 * applied to another total they still yield a complete split (three equal
 * shares become 33.34 / 33.33 / 33.33, not 33.33 × 3).
 */
export function percentagesFromAmounts(
  total: number,
  amounts: { userId: string; amount: number }[],
): Record<string, number> {
  const totalCents = toCents(total);
  if (totalCents <= 0) return {};

  // In hundredths of a percent: the integral part of each share plus what
  // rounding down dropped.
  const shares = amounts.map((a) => {
    const scaled = (toCents(a.amount) * 10000) / totalCents;
    return { userId: a.userId, units: Math.floor(scaled), dropped: scaled - Math.floor(scaled) };
  });
  const sumCents = amounts.reduce((s, a) => s + toCents(a.amount), 0);
  if (Math.abs(sumCents - totalCents) / 100 > splitSumTolerance(amounts.length)) {
    // Not a complete split: plain nearest rounding, the shortfall stays visible.
    return Object.fromEntries(
      shares.map((share) => [share.userId, (share.units + (share.dropped >= 0.5 ? 1 : 0)) / 100]),
    );
  }

  // Complete: spread what is missing to reach exactly 100.00.
  const residue = 10000 - shares.reduce((s, share) => s + share.units, 0);
  const sign = residue < 0 ? -1 : 1;
  // Largest remainders first when adding, smallest when taking away; ties
  // keep member order.
  const order = shares
    .map((_, i) => i)
    .sort((i, j) => sign * (shares[j].dropped - shares[i].dropped));
  for (let k = 0; k < Math.abs(residue) && order.length > 0; k++) {
    shares[order[k % order.length]].units += sign;
  }
  return Object.fromEntries(shares.map((share) => [share.userId, share.units / 100]));
}

/**
 * Whether `splits` is an even split of its own sum among exactly `userIds` —
 * what Auto mode saves, whichever member got the rounding cent.
 */
export function isEqualSplit(splits: SplitEntry[], userIds: string[]): boolean {
  if (splits.length !== userIds.length) return false;
  const byUser = new Map(splits.map((s) => [s.userId, toCents(s.amount)]));
  if (byUser.size !== splits.length) return false;
  const cents: number[] = [];
  for (const id of userIds) {
    const amount = byUser.get(id);
    if (amount === undefined) return false;
    cents.push(amount);
  }
  const base = Math.floor(cents.reduce((s, c) => s + c, 0) / cents.length);
  return cents.every((c) => c === base || c === base + 1);
}

/**
 * The split to show and submit while the transaction being edited still holds
 * the amounts it was saved with. Rebuilding it would only differ by rounding —
 * Auto deals the extra cent by the book's line, which has moved on since, and
 * the fixed builder derives the percentages again — so an untouched edit
 * resends the stored entries verbatim.
 *
 * Returns null as soon as anything moved: the total, a share, or the mode
 * (Porcentaje always recomputes from the typed percentages).
 */
export function untouchedSplit(
  saved: { total: number; splits: SplitEntry[] },
  form: {
    total: number;
    mode: "auto" | "percentage" | "fixed";
    userIds: string[];
    fixedAmounts: Record<string, number>;
  },
): SplitEntry[] | null {
  const { splits } = saved;
  if (Math.abs(saved.total - form.total) >= 0.005) return null;
  if (form.mode === "auto") return isEqualSplit(splits, form.userIds) ? splits : null;
  if (form.mode !== "fixed") return null;

  const byUser = new Map(splits.map((s) => [s.userId, toCents(s.amount)]));
  const sameAmounts = form.userIds.every((id) => {
    const stored = byUser.get(id);
    // A member outside the saved split shows as 0.
    return stored === undefined
      ? toCents(form.fixedAmounts[id] ?? 0) === 0
      : stored === toCents(form.fixedAmounts[id] ?? 0);
  });
  const sameMembers =
    byUser.size === splits.length && splits.every((s) => form.userIds.includes(s.userId));
  return sameAmounts && sameMembers ? splits : null;
}
