import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Entity,
  EnrichedTransaction,
  Participant,
  SpawnCandidate,
  TransactionPayment,
} from "../../lib/types";
import { calculateBalance, calculatePairwiseBreakdown } from "../../lib/calculations";

/**
 * Dashboard state store — the single React owner of what used to be twelve
 * Preact signals passed between the Sidebar and TransactionList islands.
 * Both the real dashboard (DashboardShell) and the demo (DemoApp) run the
 * same reducer; realtime events, registry switches and optimistic modal
 * writes all flow through these actions.
 */

export interface DashboardState {
  registryId: string;
  transactions: EnrichedTransaction[];
  transactionPayments: TransactionPayment[];
  users: Participant[];
  currentUserId: string;
  balance: number;
  balanceEntries: BalanceBreakdownEntry[];
  defaultSplit: DefaultSplit | null;
  spawnCandidates: SpawnCandidate[];
  lastModified: string | null;
  entityIds: Set<string>;
  entities: Entity[];
}

/**
 * A registry snapshot as fetched from /api/dashboard or the IndexedDB cache.
 * `transactions` may carry ISO-string `createdAt` (the cache and JSON APIs
 * serialize dates); the reducer coerces them on apply. Absent fields keep
 * the current state — the same field-by-field semantics the old
 * registrySwitch signal payload had.
 */
export interface RegistrySnapshot {
  registryId: string;
  transactions?: unknown[];
  transactionPayments?: TransactionPayment[];
  balance?: number;
  balanceEntries?: BalanceBreakdownEntry[];
  users?: Participant[];
  currentUserId?: string;
  defaultSplit?: DefaultSplit | null;
  spawnCandidates?: SpawnCandidate[];
  entityIds?: string[];
  entities?: Entity[];
  lastModified?: string | null;
}

export type DashboardAction =
  | { type: "APPLY_SNAPSHOT"; snapshot: RegistrySnapshot }
  | { type: "REALTIME_INSERT"; tx: EnrichedTransaction }
  | { type: "REALTIME_DELETE"; id: string }
  | { type: "REALTIME_UPDATE"; tx: EnrichedTransaction }
  | { type: "SET_TRANSACTIONS"; transactions: EnrichedTransaction[] }
  | { type: "SET_TRANSACTION_PAYMENTS"; transactionPayments: TransactionPayment[] }
  | { type: "REBALANCE" }
  | { type: "SET_ENTITIES"; entities: Entity[] }
  | { type: "SET_ENTITY_IDS"; entityIds: Set<string> }
  | { type: "SET_LAST_MODIFIED"; stamp: string | null };

function dedupById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** All participants (users + entities) the pairwise breakdown should know. */
function allParticipants(state: DashboardState): Participant[] {
  return dedupById([
    ...state.users.map((u) => ({ id: u.id, name: u.name, color: u.color })),
    ...state.entities.map((e) => ({ id: e.id, name: e.name, color: e.color })),
  ]);
}

/** Recompute the personal balance and pairwise breakdown from transactions. */
function withBalances(state: DashboardState, transactions: EnrichedTransaction[]): DashboardState {
  return {
    ...state,
    transactions,
    balance: calculateBalance(transactions as Parameters<typeof calculateBalance>[0], state.currentUserId),
    balanceEntries: calculatePairwiseBreakdown(
      transactions as Parameters<typeof calculatePairwiseBreakdown>[0],
      state.currentUserId,
      allParticipants(state),
    ),
  };
}

/** ISO-string createdAt (cache / JSON APIs) → Date, in place over a copy. */
function coerceTransactions(txs: unknown[]): EnrichedTransaction[] {
  return (txs as EnrichedTransaction[]).map((t) => ({
    ...t,
    createdAt:
      typeof (t as unknown as { createdAt: unknown }).createdAt === "string"
        ? new Date((t as unknown as { createdAt: string }).createdAt)
        : t.createdAt,
  }));
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "APPLY_SNAPSHOT": {
      const snap = action.snapshot;
      let next: DashboardState = { ...state, registryId: snap.registryId };
      if (snap.transactions) {
        next.transactions = coerceTransactions(snap.transactions);
      }
      if (snap.transactionPayments) {
        next.transactionPayments = snap.transactionPayments;
      }
      if (snap.balance !== undefined) next.balance = snap.balance;
      if (snap.balanceEntries) next.balanceEntries = snap.balanceEntries;
      if (snap.users) next.users = snap.users;
      if (snap.currentUserId) next.currentUserId = snap.currentUserId;
      if (snap.defaultSplit !== undefined) next.defaultSplit = snap.defaultSplit;
      if (snap.spawnCandidates !== undefined) next.spawnCandidates = snap.spawnCandidates;
      if (snap.lastModified !== undefined) next.lastModified = snap.lastModified;
      if (snap.entityIds) next.entityIds = new Set(snap.entityIds);
      if (snap.entities) next.entities = snap.entities;
      return next;
    }

    case "REALTIME_INSERT": {
      const tx = action.tx;
      if (state.transactions.some((t) => t.id === tx.id)) return state;
      let transactions: EnrichedTransaction[];
      if (tx.creatorId === state.currentUserId) {
        // Our own optimistic row just came back from the server — replace it
        // instead of duplicating it.
        const optimisticIndex = state.transactions.findIndex(
          (t) =>
            t.creatorId === tx.creatorId &&
            t.description === tx.description &&
            t.amount === tx.amount &&
            t.type === tx.type &&
            t.id !== tx.id,
        );
        if (optimisticIndex !== -1) {
          transactions = [...state.transactions];
          transactions[optimisticIndex] = tx;
        } else {
          transactions = [tx, ...state.transactions];
        }
      } else {
        transactions = [tx, ...state.transactions];
      }
      return withBalances(state, transactions);
    }

    case "REALTIME_DELETE": {
      if (!state.transactions.some((t) => t.id === action.id)) return state;
      return withBalances(state, state.transactions.filter((t) => t.id !== action.id));
    }

    case "REALTIME_UPDATE": {
      return withBalances(
        state,
        state.transactions.map((t) => (t.id === action.tx.id ? action.tx : t)),
      );
    }

    case "SET_TRANSACTIONS":
      return { ...state, transactions: action.transactions };

    case "SET_TRANSACTION_PAYMENTS":
      return { ...state, transactionPayments: action.transactionPayments };

    case "REBALANCE":
      return withBalances(state, state.transactions);

    case "SET_ENTITIES":
      return {
        ...state,
        entities: action.entities,
        entityIds: new Set(action.entities.map((e) => e.id)),
      };

    case "SET_ENTITY_IDS":
      return { ...state, entityIds: action.entityIds };

    case "SET_LAST_MODIFIED":
      return { ...state, lastModified: action.stamp };
  }
}
