import demoJson from "../../data/demo.json";
import type { RegistrySnapshot } from "../dashboard/dashboard-store";
import { calculateBalance, calculatePairwiseBreakdown } from "../../lib/calculations";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Entity,
  EnrichedTransaction,
  Participant,
  Registry,
  SpawnCandidate,
  TransactionPayment,
  TransactionSplit,
  User,
} from "../../lib/types";

/**
 * Seed data for /demo, turned into the shapes the dashboard shell consumes.
 *
 * data/demo.json is hand-written and kept short — a transaction only spells
 * out what it actually varies on (installments, notes); what the server would
 * default (exercise, recurring group, related transaction) is filled in here.
 * The demo user is a member of every book.
 */

/** One transaction as written in the JSON. */
interface SeedTransaction {
  id: string;
  description: string;
  /** Total amount — `originalAmount` on every seed row is this same value. */
  amount: number;
  type: EnrichedTransaction["type"];
  userPaid: string;
  creatorId: string;
  createdAt: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  notes?: string;
  splitJson: TransactionSplit;
}

interface SeedRegistry {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  defaultSplit: DefaultSplit | null;
  transactions: SeedTransaction[];
  transactionPayments: (Omit<TransactionPayment, "createdAt"> & { createdAt: string })[];
}

interface SeedData {
  currentUserId: string;
  users: Omit<User, "supabaseAuthId" | "createdAt" | "pro">[];
  registries: SeedRegistry[];
}

const seed = demoJson as SeedData;

/** Seed users have no signup date to speak of. */
const UNKNOWN_DATE = new Date(0);

/** A complete snapshot — every field the reducer's APPLY_SNAPSHOT reads. */
export interface DemoSnapshot extends RegistrySnapshot {
  registryId: string;
  transactions: EnrichedTransaction[];
  transactionPayments: TransactionPayment[];
  balance: number;
  balanceEntries: BalanceBreakdownEntry[];
  users: Participant[];
  currentUserId: string;
  defaultSplit: DefaultSplit | null;
  spawnCandidates: SpawnCandidate[];
  entityIds: string[];
  entities: Entity[];
  lastModified: string | null;
  remainderQueue: string[];
}

/**
 * One demo book: what the sidebar lists (`registry`), its members, and the
 * snapshot the shell applies when the book becomes active.
 */
export interface DemoBook {
  registry: Registry;
  ownerId: string;
  users: User[];
  snapshot: DemoSnapshot;
}

export function buildDemoData(): { user: User; books: DemoBook[] } {
  const seedUsers = new Map(seed.users.map((u) => [u.id, u]));
  const toUser = (id: string): User => {
    const u = seedUsers.get(id);
    if (!u) throw new Error(`data/demo.json: unknown user ${id}`);
    return { ...u, supabaseAuthId: null, createdAt: UNKNOWN_DATE, pro: null };
  };
  const { currentUserId } = seed;

  const books = seed.registries.map((r): DemoBook => {
    const users = r.memberIds.map(toUser);
    const participants: Participant[] = users.map(({ id, name, color, pro }) => ({
      id,
      name,
      color,
      pro,
    }));
    const paidBy = new Map(participants.map((p) => [p.id, p]));

    const transactions: EnrichedTransaction[] = r.transactions.map((t) => ({
      id: t.id,
      registry_id: r.id,
      description: t.description,
      amount: t.amount,
      originalAmount: t.amount,
      type: t.type,
      exerciseId: null,
      installmentCurrent: t.installmentCurrent ?? null,
      installmentTotal: t.installmentTotal ?? null,
      recurringDisabled: false,
      recurringGroupId: t.id,
      notes: t.notes ?? "",
      splitJson: t.splitJson,
      relatedTransactionId: null,
      creatorId: t.creatorId,
      userPaid: t.userPaid,
      createdAt: new Date(t.createdAt),
      paidByUser: paidBy.get(t.userPaid) ?? null,
    }));

    const transactionPayments: TransactionPayment[] = r.transactionPayments.map((tp) => ({
      ...tp,
      createdAt: new Date(tp.createdAt),
    }));

    const lastActivity = transactions.reduce<Date | null>(
      (latest, t) => (latest && latest >= t.createdAt ? latest : t.createdAt),
      null,
    );

    return {
      registry: {
        id: r.id,
        name: r.name,
        isDefault: false,
        latestAccessed: lastActivity ?? UNKNOWN_DATE,
        defaultSplit: r.defaultSplit,
        defaultSplitMemberCount: null,
        lastModified: lastActivity,
        remainderQueue: [],
      },
      ownerId: r.ownerId,
      users,
      snapshot: {
        registryId: r.id,
        transactions,
        transactionPayments,
        balance: calculateBalance(transactions, currentUserId),
        balanceEntries: calculatePairwiseBreakdown(transactions, currentUserId, participants),
        users: participants,
        currentUserId,
        defaultSplit: r.defaultSplit,
        spawnCandidates: [],
        entityIds: [],
        entities: [],
        lastModified: lastActivity?.toISOString() ?? null,
        // None of the seed expenses leaves a cent over, so nobody has taken a
        // turn yet: the first one a visitor adds starts the book's line.
        remainderQueue: [],
      },
    };
  });

  return { user: toUser(currentUserId), books };
}
