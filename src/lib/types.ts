export interface Participant {
  id: string;
  name: string;
  color: string;
  /**
   * Present (possibly null) only on participants backed by a real app USER:
   * the crown badge renders it. Entities never set it.
   */
  pro?: "subscribed" | "grandfathered" | null;
}

export interface User extends Participant {
  email: string;
  supabaseAuthId: string | null;
  createdAt: Date;
  /**
   * Why this user personally grants Pro to every group they're in:
   *   'subscribed'    — live Polar subscription (trialing/active/paid-through/grace)
   *   'grandfathered' — founding member: owns a grandfathered registry, Pro forever
   *   null            — not Pro (the crown UI renders nothing)
   * Computed in SQL (USER_PRO_SQL in lib/entitlements.ts) on queries feeding the UI;
   * absent on other queries → rowToUser maps it to null.
   */
  pro: "subscribed" | "grandfathered" | null;
}

export interface Entity extends Participant {}

export interface Transaction {
  id: string;
  registry_id: string;
  description: string;
  amount: number;
  originalAmount: number;
  type: "unico" | "parcialidad" | "recurrente" | "pago" | "ajuste";
  exerciseId: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  recurringDisabled: boolean;
  recurringGroupId: string;
  notes: string;
  splitJson: TransactionSplit;
  relatedTransactionId: string | null;
  creatorId: string | null;
  userPaid: string;
  createdAt: Date;
}

export interface Exercise {
  id: string;
  registry_id: string;
  startDate: Date;
  endDate: Date;
  transactionCount: number;
  totalAmount: number;
}

export interface DefaultSplitEntry {
  userId: string;
  percentage: number;
}

export interface DefaultSplit {
  splits: DefaultSplitEntry[];
}

export interface Registry {
  id: string;
  name: string;
  isDefault: boolean;
  latestAccessed: Date;
  defaultSplit: DefaultSplit | null;
  defaultSplitMemberCount: number | null;
  lastModified: Date | null;
}

export interface SplitEntry {
  userId: string;
  percentage: number;
  amount: number;
}

export interface TransactionSplit {
  splits: SplitEntry[];
}

export interface RegistryMember {
  id: string;
  registryId: string;
  userId: string;
  role: string;
  joinedAt: Date;
}

export interface TransactionPayment {
  id: string;
  pagoId: string;
  expenseId: string;
  amount: number;
  createdAt: Date;
}

export interface BalanceBreakdownEntry {
  userId: string;
  userName: string;
  userColor: string;
  amount: number;
}

/**
 * A recurring/installment template offered for inclusion when a new period
 * starts. Shared by the dashboard SSR handler, the recurring-spawn island and
 * the transaction list's registry-switch payload.
 */
export interface SpawnCandidate {
  id: string;
  description: string;
  type: "parcialidad" | "recurrente";
  originalAmount: number;
  installmentCurrent: number | null;
  installmentTotal: number | null;
}
