import { signal } from "@preact/signals";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Entity,
  Participant,
  SpawnCandidate,
  Transaction,
  TransactionPayment,
} from "../lib/types";

export interface EnrichedTransaction extends Transaction {
  paidByUser: Participant | null;
  transactionPayments?: TransactionPayment[];
}

/**
 * Cross-island state shared between the Sidebar, TransactionList and
 * EntityManager. These are client-only module-level signals: the dashboard's
 * islands are hydrated from server props and only synchronize through these
 * after user interaction, so nothing here is read during SSR.
 *
 * Producers assign; consumers react in `useSignalEffect`. Writes always use
 * freshly-built objects so repeated updates keep notifying.
 */

/** Full registry snapshot broadcast by the Sidebar on registry switch. */
export interface RegistrySwitchPayload {
  registryId: string;
  transactions: EnrichedTransaction[];
  transactionPayments?: TransactionPayment[];
  balance?: number;
  balanceEntries?: BalanceBreakdownEntry[];
  users?: Participant[];
  currentUserId?: string;
  defaultSplit?: DefaultSplit | null;
  spawnCandidates?: SpawnCandidate[];
  lastModified?: string | null;
  entityIds?: string[];
  entities?: Entity[];
}

/** Latest registry switch, or null before the first switch. */
export const registrySwitch = signal<RegistrySwitchPayload | null>(null);

/**
 * Entity-list updates from EntityManager. `entities` present = the new list;
 * absent = the mutation succeeded but the list wasn't returned, and
 * consumers should refetch.
 */
export const entitiesChanged = signal<{ entities?: Entity[] } | null>(null);
