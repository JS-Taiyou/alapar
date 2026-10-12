import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  SplitEntry,
  Transaction,
  TransactionSplit,
} from "./types";
import { fromCents, splitCents, toCents } from "./splits";

export function calculateBalance(
  transactions: Transaction[],
  userId: string,
): number {
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
    const divisor = tx.type === "parcialidad" && tx.installmentTotal
      ? tx.installmentTotal
      : 1;
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
      } else if (
        tx.splitJson.splits.some((s) => s.userId === currentUserId)
      ) {
        if (net[tx.userPaid] !== undefined) {
          net[tx.userPaid] -= tx.originalAmount;
        }
      }
      continue;
    }

    const divisor = tx.type === "parcialidad" && tx.installmentTotal
      ? tx.installmentTotal
      : 1;
    const currentUserSplit = tx.splitJson.splits.find((s) =>
      s.userId === currentUserId
    );
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

    const divisor = tx.type === "parcialidad" && tx.installmentTotal
      ? tx.installmentTotal
      : 1;

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
      const netAmount = Math.round(
        ((net[a][b] ?? 0) - (net[b][a] ?? 0)) * 100,
      ) / 100;
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

export function computeDefaultPercentages(
  participants: Participant[],
  defaultSplit: DefaultSplit | null,
): Record<string, number> {
  if (defaultSplit && defaultSplit.splits.length === participants.length) {
    const userIds = new Set(participants.map((u) => u.id));
    const allPresent = defaultSplit.splits.every((s) => userIds.has(s.userId));
    if (allPresent) {
      return Object.fromEntries(
        defaultSplit.splits.map((s) => [s.userId, s.percentage]),
      );
    }
  }
  return Object.fromEntries(
    participants.map((
      u,
    ) => [u.id, Math.round(10000 / participants.length) / 100]),
  );
}

export function buildEqualSplit(
  total: number,
  userIds: string[],
  seed: string = "default",
): TransactionSplit {
  const cents = splitCents(toCents(total), userIds, seed);
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
    amount: fromCents(Math.round(totalCents * p.percentage / 100)),
  }));
  return { splits };
}

export function buildFixedSplit(
  total: number,
  amounts: { userId: string; amount: number }[],
): TransactionSplit {
  const totalCents = toCents(total);
  const splits: SplitEntry[] = amounts.map((a) => ({
    userId: a.userId,
    percentage: totalCents > 0
      ? Math.round((toCents(a.amount) / totalCents) * 10000) / 100
      : 0,
    amount: a.amount,
  }));
  return { splits };
}
