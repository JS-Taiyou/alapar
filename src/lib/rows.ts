/**
 * Pure row-mapping helpers.
 *
 * Each function converts a raw result row (`Record<string, unknown>`,
 * snake_case columns, numerics as strings) into the app's typed model. They
 * have no I/O and no side effects — extracted from `lib/store.ts` so they can
 * be unit-tested without a database.
 *
 * Rows arrive from two sources with slightly different numeric shapes:
 *   - `pg` returns NUMERIC columns as **strings** (e.g. `"100.50"`).
 *   - Supabase Realtime `postgres_changes` payloads deliver them as **numbers**
 *     (JSON), e.g. `100.5`.
 * The numeric parsers below use {@link num} to handle both shapes defensively.
 *
 * Branches worth knowing (locked down by `rows_test.ts`):
 *   - `rowToTransaction.splitJson`: parsed from string when the driver returns
 *     a string, used as-is when already an object.
 *   - `rowToTransaction.recurringGroupId`: falls back to the row id when the
 *     group id is null (load-bearing for spawn-candidate grouping).
 *   - `rowToRegistry.defaultSplit`: three-way branch — falsy → null, string →
 *     JSON.parse, object → as-is.
 */
import type {
  DefaultSplit,
  Entity,
  Exercise,
  Participant,
  Registry,
  Transaction,
  TransactionPayment,
  TransactionSplit,
  User,
} from "./types";

/**
 * Parse a numeric column that may arrive as a string (from `pg`) or a number
 * (from Supabase Realtime). Falls back to `0` if absent/unparseable.
 */
function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value);
  return 0;
}

export function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    email: row.email as string,
    supabaseAuthId: (row.supabase_auth_id as string) ?? null,
    createdAt: new Date(row.created_at as string),
    // Absent on queries that didn't select USER_PRO_SQL — treated as not Pro.
    pro: (row.pro as User["pro"]) ?? null,
  };
}

export function rowToTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    registry_id: row.registry_id as string,
    description: row.description as string,
    amount: num(row.amount),
    originalAmount: num(row.original_amount),
    type: row.type as "unico" | "parcialidad" | "recurrente" | "pago" | "ajuste",
    exerciseId: row.exercise_id as string | null,
    installmentCurrent: row.installment_current as number | null,
    installmentTotal: row.installment_total as number | null,
    recurringDisabled: (row.recurring_disabled as boolean) ?? false,
    recurringGroupId: (row.recurring_group_id as string) ?? (row.id as string),
    notes: row.notes as string,
    splitJson:
      typeof row.split_json === "string"
        ? JSON.parse(row.split_json)
        : (row.split_json as TransactionSplit),
    relatedTransactionId: (row.related_transaction_id as string) ?? null,
    creatorId: row.creator_id as string,
    userPaid: row.user_paid as string,
    createdAt: new Date(row.created_at as string),
  };
}

export function rowToTransactionPayment(row: Record<string, unknown>): TransactionPayment {
  return {
    id: row.id as string,
    pagoId: row.pago_id as string,
    expenseId: row.expense_id as string,
    amount: num(row.amount),
    createdAt: new Date(row.created_at as string),
  };
}

export function rowToExercise(row: Record<string, unknown>): Exercise {
  return {
    id: row.id as string,
    registry_id: row.registry_id as string,
    startDate: new Date(row.start_date as string),
    endDate: new Date(row.end_date as string),
    transactionCount: row.transaction_count as number,
    totalAmount: num(row.total_amount),
  };
}

export function rowToRegistry(row: Record<string, unknown>): Registry {
  return {
    id: row.id as string,
    name: row.name as string,
    isDefault: row.is_default as boolean,
    latestAccessed: new Date(row.latest_accessed as string),
    defaultSplit: row.default_split_json
      ? typeof row.default_split_json === "string"
        ? JSON.parse(row.default_split_json)
        : (row.default_split_json as DefaultSplit)
      : null,
    defaultSplitMemberCount: (row.default_split_member_count as number) ?? null,
    lastModified: row.last_modified ? new Date(row.last_modified as string) : null,
  };
}

// Entity and Participant are structurally identical for row-mapping purposes;
// re-exported here for symmetry, used by store.getEntities.
export function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
  };
}

/**
 * A transaction plus the resolved `paidByUser` participant. This is the shape
 * the transactions GET endpoint and the client TransactionList island both
 * consume. Defined here (rather than in `islands/shared-signals.ts`) so the
 * shared enrichment helper has no island dependency.
 */
export type EnrichedTransaction = Transaction & {
  paidByUser: Participant | null;
};

/**
 * Map a raw row to an {@link EnrichedTransaction}, resolving `paidByUser`
 * against the supplied participant map (keyed by participant id). Used by both
 * the server (transactions GET) and the client (Supabase Realtime payloads) so
 * the two enrichment paths can never drift.
 */
export function rowToEnrichedTransaction(
  row: Record<string, unknown>,
  participantMap: Map<string, Participant>,
): EnrichedTransaction {
  return {
    ...rowToTransaction(row),
    paidByUser: participantMap.get(row.user_paid as string) ?? null,
  };
}
