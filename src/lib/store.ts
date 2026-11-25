import { query, withTransaction } from "./db";
import type { QueryFn } from "./db";
import {
  countRegistryMembers,
  getRegistryPlan,
  GroupFullError,
  USER_PRO_SQL,
} from "./entitlements";
import type {
  Entity,
  Exercise,
  Participant,
  Registry,
  SplitMode,
  Transaction,
  TransactionPayment,
  TransactionSplit,
  User,
} from "./types";
import {
  buildEqualSplit,
  buildFixedSplit,
  buildPercentageSplit,
  calculateBalance as calcBalancePure,
  isEqualSplit,
  resolveTransactionSplit,
  sameSplitCents,
  calculateFullPairwiseBalances as calcFullPairwisePure,
  calculatePairwiseBreakdown as calcPairwiseBreakdownPure,
} from "./calculations";
import { getUserActiveRegistry } from "./server-cache";
import {
  rowToExercise,
  rowToRegistry,
  rowToTransaction,
  rowToTransactionPayment,
  rowToUser,
} from "./rows";
import { parseRemainderQueue } from "./rows";
import { filterSpawnCandidates, generateInviteCode } from "./invite";
import { buildBatchPlaceholders, buildTransactionUpdateSets } from "./sql-builders";
import { computeDeltas } from "./balances";

export {
  buildEqualSplit,
  buildFixedSplit,
  buildPercentageSplit,
  calcFullPairwisePure as calculateFullPairwiseBalances,
  calcPairwiseBreakdownPure as calculatePairwiseBreakdown,
};
export { generateInviteCode };

/**
 * Write the computed balance deltas for a transaction into the
 * `transaction_balances` table. Called after every transaction INSERT and on
 * update (after deleting stale rows). Uses UPSERT to be idempotent.
 *
 * `q` is the executor: the pool by default, or a transaction's client when
 * called inside `withTransaction` (the write must not escape the unit).
 */
async function writeTransactionBalances(tx: Transaction, q: QueryFn = query): Promise<void> {
  const deltas = computeDeltas(tx);
  if (deltas.length === 0) return;
  const values: unknown[] = [];
  const placeholders = deltas
    .map((d, i) => {
      const base = i * 3;
      values.push(tx.id, d.userId, d.amount);
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    })
    .join(", ");
  await q(
    `INSERT INTO transaction_balances (transaction_id, user_id, amount) VALUES ${placeholders}
     ON CONFLICT (transaction_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
    values,
  );
}

/**
 * Batched variant of {@link writeTransactionBalances}: one multi-row INSERT
 * for the deltas of many transactions. `batchCloneTransactions` uses this so
 * cloning N transactions doesn't mean N sequential balance queries.
 */
async function writeTransactionBalancesBatch(
  txs: Transaction[],
  q: QueryFn = query,
): Promise<void> {
  const params: unknown[] = [];
  const rowFragments: string[] = [];
  for (const tx of txs) {
    for (const d of computeDeltas(tx)) {
      const base = params.length;
      params.push(tx.id, d.userId, d.amount);
      rowFragments.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    }
  }
  if (rowFragments.length === 0) return;
  await q(
    `INSERT INTO transaction_balances (transaction_id, user_id, amount) VALUES ${rowFragments.join(
      ", ",
    )}
     ON CONFLICT (transaction_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
    params,
  );
}

/** Delete persisted balance deltas for a transaction (before re-computing on update). */
async function deleteTransactionBalances(transactionId: string, q: QueryFn = query): Promise<void> {
  await q("DELETE FROM transaction_balances WHERE transaction_id = $1", [transactionId]);
}

/**
 * Bump the registry's `last_modified` stamp — the version every cache layer
 * (server in-memory, client IndexedDB snapshot) validates freshness against.
 *
 * Always call this INSIDE the mutation's own transaction (pass the executor),
 * never as a standalone statement after it: a post-commit fire-and-forget
 * UPDATE can fail silently, leaving the stamp unchanged while the data did
 * change — every cache would then conclude "fresh" and keep serving
 * pre-mutation rows. Sharing the transaction makes data + stamp commit
 * atomically.
 */
export async function touchRegistryStamp(registryId: string, q: QueryFn = query): Promise<void> {
  await q("UPDATE registries SET last_modified = NOW() WHERE id = $1", [registryId]);
}

export async function getUserBySupabaseId(supabaseAuthId: string): Promise<User | null> {
  const result = await query("SELECT * FROM users WHERE supabase_auth_id = $1", [supabaseAuthId]);
  if (result.rows.length === 0) return null;
  return rowToUser(result.rows[0]);
}

export async function createUserFromSupabase(
  supabaseAuthId: string,
  email: string,
  name: string,
): Promise<User> {
  const result = await query(
    "INSERT INTO users (email, name, supabase_auth_id, color) VALUES ($1, $2, $3, $4) ON CONFLICT (supabase_auth_id) DO UPDATE SET email = $1, name = $2 RETURNING *",
    [email, name, supabaseAuthId, "#093eaa"],
  );
  return rowToUser(result.rows[0]);
}

export async function resolveUserState(supabaseAuthId: string): Promise<{
  user: User | null;
  activeRegistry: Registry | null;
  isOwner: boolean;
  ownerRegistryIds: Set<string>;
  registries: Registry[];
  registryUsers: User[];
  entities: Entity[];
  participants: Participant[];
}> {
  const userResult = await query(
    `SELECT u.*, ${USER_PRO_SQL} FROM users u WHERE u.supabase_auth_id = $1`,
    [supabaseAuthId],
  );
  if (userResult.rows.length === 0) {
    return {
      user: null,
      activeRegistry: null,
      isOwner: false,
      ownerRegistryIds: new Set<string>(),
      registries: [],
      registryUsers: [],
      entities: [],
      participants: [],
    };
  }

  const row = userResult.rows[0];
  const user = rowToUser(row);

  const registriesResult = await query(
    `SELECT r.*, rm.role as membership_role FROM registries r
     JOIN registry_members rm ON r.id = rm.registry_id
     WHERE rm.user_id = $1
     ORDER BY r.name`,
    [user.id],
  );

  const registriesList = registriesResult.rows.map(rowToRegistry);
  const ownerRegistryIds = new Set<string>(
    registriesResult.rows.filter((r) => r.membership_role === "owner").map((r) => r.id as string),
  );
  let activeRegistry: Registry | null = null;
  let isOwner = false;
  let registryUsers: User[] = [];
  let entities: Entity[] = [];
  let participants: Participant[] = [];

  if (registriesList.length > 0) {
    const cachedActiveId = getUserActiveRegistry(user.id);
    activeRegistry = cachedActiveId
      ? (registriesList.find((r) => r.id === cachedActiveId) ?? registriesList[0])
      : registriesList[0];
    const activeIdx = registriesList.indexOf(activeRegistry);
    const activeRow = registriesResult.rows[activeIdx];
    isOwner = activeRow.membership_role === "owner";

    const usersResult = await query(
      `SELECT u.*, ${USER_PRO_SQL} FROM users u
       JOIN registry_members rm ON rm.user_id = u.id
       WHERE rm.registry_id = $1`,
      [activeRegistry.id],
    );
    registryUsers = usersResult.rows.map(rowToUser);

    entities = await getEntities(activeRegistry.id, user.id);

    participants = [
      ...registryUsers.map((u) => ({
        id: u.id,
        name: u.name,
        color: u.color,
        pro: u.pro,
      })),
      ...entities.map((e) => ({ id: e.id, name: e.name, color: e.color })),
    ];
  }

  return {
    user,
    activeRegistry,
    isOwner,
    ownerRegistryIds,
    registries: registriesList,
    registryUsers,
    entities,
    participants,
  };
}

export async function getUsers(registryId: string): Promise<User[]> {
  const result = await query(
    `SELECT u.*, ${USER_PRO_SQL} FROM users u
     JOIN registry_members rm ON rm.user_id = u.id
     WHERE rm.registry_id = $1`,
    [registryId],
  );
  return result.rows.map(rowToUser);
}

export async function getUserById(id: string): Promise<User | undefined> {
  const result = await query("SELECT * FROM users WHERE id = $1", [id]);
  if (result.rows.length === 0) return undefined;
  return rowToUser(result.rows[0]);
}

export async function getActiveTransactions(registryId: string): Promise<Transaction[]> {
  const result = await query(
    "SELECT * FROM transactions WHERE exercise_id IS NULL AND registry_id = $1 ORDER BY created_at DESC, description ASC",
    [registryId],
  );
  return result.rows.map(rowToTransaction);
}

export async function getTransactionsByExercise(exerciseId: string): Promise<Transaction[]> {
  const result = await query(
    "SELECT * FROM transactions WHERE exercise_id = $1 ORDER BY created_at DESC, description ASC",
    [exerciseId],
  );
  return result.rows.map(rowToTransaction);
}

/**
 * Membership-scoped variant of {@link getTransactionsByExercise}: returns rows
 * only when `userId` belongs to the registry that owns the exercise. API
 * routes use this so a bare exercise id can't leak another registry's data.
 */
export async function getTransactionsByExerciseForUser(
  exerciseId: string,
  userId: string,
): Promise<Transaction[]> {
  const result = await query(
    `SELECT t.* FROM transactions t WHERE t.exercise_id = $1
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = t.registry_id AND rm.user_id = $2
     )
     ORDER BY t.created_at DESC, t.description ASC`,
    [exerciseId, userId],
  );
  return result.rows.map(rowToTransaction);
}

export async function getTransactionById(id: string): Promise<Transaction | undefined> {
  const result = await query("SELECT * FROM transactions WHERE id = $1", [id]);
  if (result.rows.length === 0) return undefined;
  return rowToTransaction(result.rows[0]);
}

/** Fetch several transactions by id in one query (used for cross-reference validation). */
export async function getTransactionsByIds(ids: string[]): Promise<Transaction[]> {
  if (ids.length === 0) return [];
  const result = await query("SELECT * FROM transactions WHERE id = ANY($1::uuid[])", [ids]);
  return result.rows.map(rowToTransaction);
}

export async function getTransactionPaymentsForRegistry(
  registryId: string,
): Promise<TransactionPayment[]> {
  const result = await query(
    `SELECT tp.* FROM transaction_payments tp
     JOIN transactions t ON t.id = tp.pago_id
     WHERE t.registry_id = $1 AND t.exercise_id IS NULL`,
    [registryId],
  );
  return result.rows.map(rowToTransactionPayment);
}

export async function getTransactionPaymentsForPago(pagoId: string): Promise<TransactionPayment[]> {
  const result = await query("SELECT * FROM transaction_payments WHERE pago_id = $1", [pagoId]);
  return result.rows.map(rowToTransactionPayment);
}

export async function createTransactionPayments(
  pagoId: string,
  entries: { expenseId: string; amount: number }[],
  q: QueryFn = query,
): Promise<TransactionPayment[]> {
  if (entries.length === 0) return [];
  const values: unknown[] = [];
  const placeholders = entries
    .map((e, i) => {
      const base = i * 3;
      values.push(pagoId, e.expenseId, e.amount);
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    })
    .join(", ");
  const result = await q(
    `INSERT INTO transaction_payments (pago_id, expense_id, amount) VALUES ${placeholders} RETURNING *`,
    values,
  );
  return result.rows.map(rowToTransactionPayment);
}

export async function deleteTransactionPaymentsForPago(
  pagoId: string,
  q: QueryFn = query,
): Promise<void> {
  await q("DELETE FROM transaction_payments WHERE pago_id = $1", [pagoId]);
}

/** A transaction as its write returns it, with the book's line when the write dealt a split against it. */
export type DealtTransaction = Transaction & { remainderQueue?: string[] };

const isExpense = (type: Transaction["type"]) => type !== "pago" && type !== "ajuste";

/** A stored `split_json` as the app's type, or null when the column holds anything else. */
function parseSplit(value: unknown): TransactionSplit | null {
  const split = typeof value === "string" ? JSON.parse(value) : value;
  return split && typeof split === "object" && Array.isArray((split as TransactionSplit).splits)
    ? (split as TransactionSplit)
    : null;
}

/** A book's line under lock: `line` is what dealing moves, `save` writes it back. */
interface HeldLine {
  line: string[];
  save: () => Promise<void>;
}

/**
 * Hold a book's line for the rest of the transaction: two saves racing each
 * other must not hand the same turn to two people. Runs on the executor of
 * the write it belongs to, so the split and the line commit or roll back
 * together.
 *
 * The line is read with an UPDATE that changes nothing. In production,
 * Hyperdrive sits in front of Postgres: it caches read-only results, keeps
 * them after a write, and does not say whether a locking read is spared. A
 * write is never served from that cache, and an UPDATE takes the row lock
 * this needs anyway.
 */
async function holdLine(q: QueryFn, registryId: string): Promise<HeldLine> {
  const lock = await q(
    "UPDATE registries SET remainder_queue = remainder_queue WHERE id = $1 RETURNING remainder_queue",
    [registryId],
  );
  const asStored = JSON.stringify(parseRemainderQueue(lock.rows[0]?.remainder_queue));
  const held: HeldLine = {
    line: parseRemainderQueue(lock.rows[0]?.remainder_queue),
    save: async () => {
      const line = JSON.stringify(held.line);
      if (line === asStored) return;
      await q("UPDATE registries SET remainder_queue = $2::jsonb WHERE id = $1", [
        registryId,
        line,
      ]);
    },
  };
  return held;
}

/** Deal one split against a held line. `save` once every split of the write is dealt. */
function deal(
  held: HeldLine,
  mode: SplitMode | undefined,
  total: number,
  split: TransactionSplit,
): TransactionSplit {
  const dealt = resolveTransactionSplit(mode, total, split, held.line);
  held.line = dealt.line;
  return dealt.split;
}

/**
 * Deal each clone against its book's line, one after another in the order
 * given. A period created now takes the turn that is next on the line its
 * book keeps for every expense — not a turn of its own series — so an
 * expense whose split changed in between is dealt with the split it has now.
 * Returns the split to save for each clone.
 */
async function dealClones(q: QueryFn, clones: readonly Transaction[]): Promise<TransactionSplit[]> {
  // Monto Fijo, and anything without a mode, is the user's own cents: copied
  // as it stands, and never so much as a lock on the line.
  const dealt = clones.filter((clone) => {
    const mode = cloneSplitMode(clone);
    return mode !== undefined && mode !== "fixed";
  });
  // Several books in one batch are held in id order, so two batches spanning
  // the same books never wait on each other.
  const held = new Map<string, HeldLine>();
  for (const registryId of [...new Set(dealt.map((clone) => clone.registry_id))].sort()) {
    held.set(registryId, await holdLine(q, registryId));
  }
  const splits = clones.map((clone) => {
    const line = held.get(clone.registry_id);
    return line
      ? deal(line, cloneSplitMode(clone), clone.originalAmount, clone.splitJson)
      : clone.splitJson;
  });
  for (const line of held.values()) await line.save();
  return splits;
}

export async function createTransaction(
  data: Omit<Transaction, "id" | "createdAt"> & { splitMode?: SplitMode },
  userId: string,
  transactionPaymentEntries?: { expenseId: string; amount: number }[],
  q?: QueryFn,
): Promise<DealtTransaction | null> {
  const member = await isMemberOfRegistry(userId, data.registry_id);
  if (!member) return null;
  const recurringGroupId = data.recurringGroupId ?? crypto.randomUUID();
  // Transaction + linked payments + balance deltas are one unit: a failure
  // after the INSERT must not leave a transaction whose balances never got
  // persisted (the deltas table is what balances are summed from). When an
  // outer transaction's executor is passed, join it instead of opening one.
  const insert = async (executor: QueryFn): Promise<DealtTransaction> => {
    // The line goes first: it is the row every write to this book ends up
    // locking (the stamp trigger), so no later step can wait on it out of turn.
    let splitJson = data.splitJson;
    let remainderQueue: string[] | undefined;
    if (data.splitMode && isExpense(data.type)) {
      const held = await holdLine(executor, data.registry_id);
      splitJson = deal(held, data.splitMode, data.originalAmount, splitJson);
      await held.save();
      remainderQueue = held.line;
    }
    const result = await executor(
      `INSERT INTO transactions (registry_id, description, amount, original_amount, type, exercise_id, installment_current, installment_total, recurring_disabled, recurring_group_id, notes, split_json, creator_id, user_paid, related_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        data.registry_id,
        data.description,
        data.amount,
        data.originalAmount,
        data.type,
        data.exerciseId,
        data.installmentCurrent,
        data.installmentTotal,
        data.recurringDisabled ?? false,
        recurringGroupId,
        data.notes,
        JSON.stringify(splitJson),
        data.creatorId,
        data.userPaid,
        data.relatedTransactionId ?? null,
      ],
    );
    const tx = rowToTransaction(result.rows[0]);
    if (transactionPaymentEntries && transactionPaymentEntries.length > 0) {
      await createTransactionPayments(tx.id, transactionPaymentEntries, executor);
    }
    await writeTransactionBalances(tx, executor);
    await touchRegistryStamp(tx.registry_id, executor);
    return remainderQueue ? { ...tx, remainderQueue } : tx;
  };
  if (q) return await insert(q);
  return await withTransaction(insert);
}

export async function updateTransaction(
  id: string,
  data: Partial<Transaction> & { splitMode?: SplitMode },
  userId: string,
  transactionPaymentEntries?: { expenseId: string; amount: number }[],
): Promise<DealtTransaction | undefined> {
  if (buildTransactionUpdateSets(data).sets.length === 0) return getTransactionById(id);
  // The UPDATE, the payment rows and the recomputed deltas are one unit:
  // partially applying them leaves balances drifted from the transaction.
  return await withTransaction(async (q) => {
    // A split the user left alone keeps the cents it was saved with: a
    // description edit must not hand the extra cent to someone else. Only a
    // split that changed is dealt again, against the line as it stands now.
    let remainderQueue: string[] | undefined;
    if (data.splitJson && data.splitMode) {
      // The row being edited, then its book's line — the order every write
      // here takes (the row first, the book's stamp last), so none can
      // deadlock. Hyperdrive, in front of production Postgres, answers
      // read-only queries from a cache that no write clears, and leaves alone
      // queries with a STABLE function in them: hence `now()`, which is
      // always true.
      const current = await q(
        `SELECT registry_id, type, original_amount, split_json FROM transactions WHERE id = $1 AND now() IS NOT NULL AND registry_id IN (SELECT rm.registry_id FROM registry_members rm WHERE rm.user_id = $2 AND rm.registry_id = transactions.registry_id) FOR UPDATE`,
        [id, userId],
      );
      if (current.rows.length === 0) return undefined;
      const stored = current.rows[0];
      const saved = parseSplit(stored.split_json);

      if (saved && isExpense(data.type ?? (stored.type as Transaction["type"]))) {
        if (sameSplitCents(data.splitJson.splits, saved.splits)) {
          // Saved again as it was, mode included: that is what later periods
          // of this expense are dealt by. The form reads any even-looking
          // split as Auto, so its word is only taken for a row older than the
          // modes.
          data = { ...data, splitJson: saved.mode ? saved : { ...saved, mode: data.splitMode } };
        } else {
          const held = await holdLine(q, stored.registry_id as string);
          data = {
            ...data,
            splitJson: deal(
              held,
              data.splitMode,
              data.originalAmount ?? Number(stored.original_amount),
              data.splitJson,
            ),
          };
          await held.save();
          remainderQueue = held.line;
        }
      }
    }

    const { sets, values } = buildTransactionUpdateSets(data);
    const idx = values.length + 1;
    values.push(id);
    values.push(userId);
    const result = await q(
      `UPDATE transactions SET ${sets.join(
        ", ",
      )} WHERE id = $${idx} AND registry_id IN (SELECT rm.registry_id FROM registry_members rm WHERE rm.user_id = $${
        idx + 1
      } AND rm.registry_id = transactions.registry_id) RETURNING *`,
      values,
    );
    if (result.rows.length === 0) return undefined;
    const updated = rowToTransaction(result.rows[0]);
    if (transactionPaymentEntries !== undefined) {
      await deleteTransactionPaymentsForPago(id, q);
      if (transactionPaymentEntries.length > 0) {
        await createTransactionPayments(id, transactionPaymentEntries, q);
      }
    }
    // Recompute balance deltas if any delta-relevant field changed.
    const deltaRelevant =
      data.amount !== undefined ||
      data.originalAmount !== undefined ||
      data.type !== undefined ||
      data.splitJson !== undefined ||
      data.userPaid !== undefined ||
      data.installmentCurrent !== undefined ||
      data.installmentTotal !== undefined;
    if (deltaRelevant) {
      await deleteTransactionBalances(id, q);
      await writeTransactionBalances(updated, q);
    }
    await touchRegistryStamp(updated.registry_id, q);
    return remainderQueue ? { ...updated, remainderQueue } : updated;
  });
}

export async function deleteTransaction(id: string, userId: string): Promise<boolean> {
  // Delete + stamp bump are one unit: RETURNING captures the registry without
  // a second read, and the bump commits with the delete.
  return await withTransaction(async (q) => {
    const result = await q(
      `DELETE FROM transactions WHERE id = $1 AND registry_id IN (SELECT rm.registry_id FROM registry_members rm WHERE rm.user_id = $2 AND rm.registry_id = transactions.registry_id) RETURNING registry_id`,
      [id, userId],
    );
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      await touchRegistryStamp(result.rows[0].registry_id as string, q);
    }
    return deleted;
  });
}

export async function getExercises(registryId: string): Promise<Exercise[]> {
  const result = await query(
    "SELECT * FROM exercises WHERE registry_id = $1 ORDER BY end_date DESC",
    [registryId],
  );
  return result.rows.map(rowToExercise);
}

export async function getExerciseById(id: string): Promise<Exercise | undefined> {
  const result = await query("SELECT * FROM exercises WHERE id = $1", [id]);
  if (result.rows.length === 0) return undefined;
  return rowToExercise(result.rows[0]);
}

/**
 * Membership-scoped variant of {@link getExerciseById}: returns the exercise
 * only when `userId` belongs to its registry (else `undefined`, so the caller
 * can answer 404 without leaking existence).
 */
export async function getExerciseByIdForUser(
  id: string,
  userId: string,
): Promise<Exercise | undefined> {
  const result = await query(
    `SELECT e.* FROM exercises e WHERE e.id = $1
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = e.registry_id AND rm.user_id = $2
     )`,
    [id, userId],
  );
  if (result.rows.length === 0) return undefined;
  return rowToExercise(result.rows[0]);
}

export async function createExercise(registryId: string, q: QueryFn = query): Promise<Exercise> {
  const result = await q(
    `WITH active AS (
      SELECT id, original_amount, created_at
      FROM transactions
      WHERE registry_id = $1 AND exercise_id IS NULL
    ),
    new_exercise AS (
      INSERT INTO exercises (registry_id, start_date, end_date, transaction_count, total_amount)
      SELECT $1,
             COALESCE(MIN(created_at), now()),
             now(),
             COUNT(*),
             COALESCE(SUM(ABS(original_amount)), 0)
      FROM active
      RETURNING id, registry_id, start_date, end_date, transaction_count, total_amount
    ),
    updated AS (
      UPDATE transactions SET exercise_id = (SELECT id FROM new_exercise)
      WHERE registry_id = $1 AND exercise_id IS NULL
    )
    SELECT * FROM new_exercise`,
    [registryId],
  );
  // Archiving a period is a registry mutation even when no carry-forward
  // ajustes are written — bump inside the caller's transaction (the cortar
  // route always passes one).
  await touchRegistryStamp(registryId, q);
  return rowToExercise(result.rows[0]);
}

export async function getRegistriesForUser(userId: string): Promise<Registry[]> {
  const result = await query(
    `SELECT r.* FROM registries r JOIN registry_members rm ON r.id = rm.registry_id WHERE rm.user_id = $1 ORDER BY r.latest_accessed DESC`,
    [userId],
  );
  return result.rows.map(rowToRegistry);
}

export async function createRegistry(name: string, userId: string): Promise<Registry> {
  return await withTransaction(async (q) => {
    const result = await q(
      "INSERT INTO registries (name, is_default) VALUES ($1, false) RETURNING *",
      [name],
    );
    const registry = rowToRegistry(result.rows[0]);
    await q(
      "INSERT INTO registry_members (registry_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING",
      [registry.id, userId],
    );
    return registry;
  });
}

export async function renameRegistry(
  registryId: string,
  name: string,
  userId: string,
): Promise<Registry | undefined> {
  const member = await isMemberOfRegistry(userId, registryId);
  if (!member) return undefined;
  const result = await query("UPDATE registries SET name = $1 WHERE id = $2 RETURNING *", [
    name,
    registryId,
  ]);
  if (result.rows.length === 0) return undefined;
  return rowToRegistry(result.rows[0]);
}

export async function getTransactionCount(registryId: string): Promise<number> {
  const result = await query("SELECT COUNT(*) as cnt FROM transactions WHERE registry_id = $1", [
    registryId,
  ]);
  return parseInt(result.rows[0].cnt as string);
}

export async function getTransactionCounts(registryIds: string[]): Promise<Map<string, number>> {
  if (registryIds.length === 0) return new Map();
  const result = await query(
    "SELECT registry_id, COUNT(*) as cnt FROM transactions WHERE registry_id = ANY($1::uuid[]) GROUP BY registry_id",
    [registryIds],
  );
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.registry_id as string, parseInt(row.cnt as string));
  }
  return map;
}

export async function deleteRegistry(registryId: string, userId: string): Promise<boolean> {
  const count = await getTransactionCount(registryId);
  if (count > 0) return false;
  // Owner-only: the DELETE itself carries the ownership subquery so it can't
  // be misused by a caller that skipped the role check.
  const result = await query(
    `DELETE FROM registries WHERE id = $1 AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = registries.id AND rm.user_id = $2 AND rm.role = 'owner'
     )`,
    [registryId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getUserRole(userId: string, registryId: string): Promise<string | null> {
  const result = await query(
    "SELECT role FROM registry_members WHERE registry_id = $1 AND user_id = $2",
    [registryId, userId],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].role as string;
}

export async function isMemberOfRegistry(userId: string, registryId: string): Promise<boolean> {
  const result = await query(
    "SELECT 1 FROM registry_members WHERE registry_id = $1 AND user_id = $2",
    [registryId, userId],
  );
  return result.rows.length > 0;
}

export async function calculateBalance(
  userId: string,
  registryId: string,
  preloadedTransactions?: Transaction[],
): Promise<number> {
  const active = preloadedTransactions ?? (await getActiveTransactions(registryId));
  return calcBalancePure(active, userId);
}

/**
 * Read the authoritative balance from persisted `transaction_balances` deltas.
 * Uses exact NUMERIC(12,2) arithmetic — no floating-point residue.
 * Falls back to `calculateBalance` if the deltas table doesn't exist yet
 * (pre-migration), making the rollout safe.
 */
export async function getBalanceFromDeltas(userId: string, registryId: string): Promise<number> {
  const result = await query(
    `SELECT COALESCE(SUM(tb.amount), 0) as balance
     FROM transaction_balances tb
     JOIN transactions t ON t.id = tb.transaction_id
     WHERE tb.user_id = $1 AND t.registry_id = $2 AND t.exercise_id IS NULL`,
    [userId, registryId],
  );
  return parseFloat(result.rows[0].balance as string);
}

export async function getSpawnCandidates(registryId: string): Promise<Transaction[]> {
  const result = await query(
    `SELECT * FROM transactions
     WHERE registry_id = $1
       AND recurring_disabled = false
       AND (type = 'recurrente' OR type = 'parcialidad')
     ORDER BY recurring_group_id, created_at DESC`,
    [registryId],
  );
  const all = result.rows.map(rowToTransaction);
  return filterSpawnCandidates(all);
}

/**
 * How a later period of `source` is dealt. An expense the server dealt
 * carries its mode; an older even split is Auto by the app's own reading of
 * it (the form opens it in Auto); anything else is the user's own cents and
 * is copied as it stands.
 */
function cloneSplitMode(source: Transaction): SplitMode | undefined {
  return (
    source.splitJson.mode ??
    (isEqualSplit(
      source.splitJson.splits,
      source.splitJson.splits.map((s) => s.userId),
    )
      ? "auto"
      : undefined)
  );
}

export async function cloneTransactionForNextPeriod(
  sourceId: string,
  installmentOffset: number = 1,
): Promise<Transaction> {
  const source = await getTransactionById(sourceId);
  if (!source) throw new Error(`Transaction ${sourceId} not found`);
  const recurringGroupId = source.recurringGroupId ?? crypto.randomUUID();
  return await withTransaction(async (q) => {
    const [splitJson] = await dealClones(q, [source]);
    const result = await q(
      `INSERT INTO transactions (registry_id, description, amount, original_amount, type, exercise_id, installment_current, installment_total, recurring_disabled, recurring_group_id, notes, split_json, creator_id, user_paid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        source.registry_id,
        source.description,
        source.amount,
        source.originalAmount,
        source.type,
        null,
        source.type === "parcialidad" && source.installmentCurrent !== null
          ? source.installmentCurrent + installmentOffset
          : null,
        source.type === "parcialidad" ? source.installmentTotal : null,
        false,
        recurringGroupId,
        source.notes,
        JSON.stringify(splitJson),
        source.creatorId,
        source.userPaid,
      ],
    );
    const cloned = rowToTransaction(result.rows[0]);
    await writeTransactionBalances(cloned, q);
    await touchRegistryStamp(cloned.registry_id, q);
    return cloned;
  });
}

export async function batchCloneTransactions(
  items: { id: string; quantity: number }[],
  userId: string,
): Promise<Transaction[]> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  // Membership-scoped: only resolve sources in registries the user belongs
  // to, so a bare id from another registry can never be cloned into it.
  const result = await query(
    `SELECT * FROM transactions WHERE id = ANY($1::uuid[])
     AND registry_id IN (
       SELECT rm.registry_id FROM registry_members rm WHERE rm.user_id = $2
     )`,
    [ids, userId],
  );
  const sources = new Map(result.rows.map(rowToTransaction).map((t) => [t.id, t]));

  // One entry per row to insert, in the order the client asked for them:
  // that is the order the books' lines hand out their turns.
  const clones: { source: Transaction; installment: number | null }[] = [];
  for (const item of items) {
    const source = sources.get(item.id);
    if (!source) continue;
    const quantity = source.type === "parcialidad" ? item.quantity : 1;
    for (let i = 1; i <= quantity; i++) {
      clones.push({
        source,
        installment:
          source.type === "parcialidad" && source.installmentCurrent !== null
            ? source.installmentCurrent + i
            : null,
      });
    }
  }

  if (clones.length === 0) return [];

  const cols = 14;
  const placeholders = buildBatchPlaceholders(clones.length, cols);

  const cloned = await withTransaction(async (q) => {
    const splitJsons = await dealClones(
      q,
      clones.map((clone) => clone.source),
    );
    const rows = clones.map(({ source, installment }, i) => [
      source.registry_id,
      source.description,
      source.amount,
      source.originalAmount,
      source.type,
      null,
      installment,
      source.type === "parcialidad" ? source.installmentTotal : null,
      false,
      source.recurringGroupId ?? crypto.randomUUID(),
      source.notes,
      JSON.stringify(splitJsons[i]),
      source.creatorId,
      source.userPaid,
    ]);
    const insertResult = await q(
      `INSERT INTO transactions (registry_id, description, amount, original_amount, type, exercise_id, installment_current, installment_total, recurring_disabled, recurring_group_id, notes, split_json, creator_id, user_paid) VALUES ${placeholders} RETURNING *`,
      rows.flat(),
    );
    const inserted = insertResult.rows.map(rowToTransaction);
    // One batched INSERT for all cloned transactions' deltas — cloning a
    // large batch must not mean one balance query per row against the pool.
    await writeTransactionBalancesBatch(inserted, q);
    // A batch may span several of the user's registries — stamp each once.
    for (const registryId of new Set(inserted.map((r) => r.registry_id))) {
      await touchRegistryStamp(registryId, q);
    }
    return inserted;
  });
  return cloned;
}

export async function getEntities(registryId: string, userId: string): Promise<Entity[]> {
  // Membership-scoped: non-members see an empty list, same as "no entities".
  const result = await query(
    `SELECT entities_json FROM registries r WHERE r.id = $1
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = r.id AND rm.user_id = $2
     )`,
    [registryId, userId],
  );
  if (result.rows.length === 0) return [];
  const raw = result.rows[0].entities_json;
  if (!raw) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw as unknown[]);
  return parsed.map((e: Record<string, unknown>) => ({
    id: e.id as string,
    name: e.name as string,
    color: e.color as string,
  }));
}

export async function createEntity(
  registryId: string,
  name: string,
  color: string | undefined,
  userId: string,
): Promise<Entity | null> {
  const entities = await getEntities(registryId, userId);
  const entity: Entity = {
    id: crypto.randomUUID(),
    name,
    color: color ?? "#6b7280",
  };
  entities.push(entity);
  const result = await query(
    `UPDATE registries SET entities_json = $1, last_modified = NOW() WHERE id = $2
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = registries.id AND rm.user_id = $3
     )`,
    [JSON.stringify(entities), registryId, userId],
  );
  if ((result.rowCount ?? 0) === 0) return null;
  return entity;
}

export async function updateEntity(
  registryId: string,
  entityId: string,
  name: string,
  color: string | undefined,
  userId: string,
): Promise<Entity | undefined> {
  const entities = await getEntities(registryId, userId);
  const idx = entities.findIndex((e) => e.id === entityId);
  if (idx === -1) return undefined;
  entities[idx] = {
    ...entities[idx],
    name,
    color: color ?? entities[idx].color,
  };
  const result = await query(
    `UPDATE registries SET entities_json = $1, last_modified = NOW() WHERE id = $2
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = registries.id AND rm.user_id = $3
     )`,
    [JSON.stringify(entities), registryId, userId],
  );
  if ((result.rowCount ?? 0) === 0) return undefined;
  return entities[idx];
}

export async function deleteEntity(
  registryId: string,
  entityId: string,
  userId: string,
): Promise<boolean> {
  // Reference check via JSONB containment (backed by the
  // idx_transactions_split_json GIN index): the entity is in use if it paid
  // any active transaction or appears as a split participant in one. Unlike
  // the previous `split_json::text LIKE` this can't false-match on
  // serialization quirks or special characters in the id.
  const txCheck = await query(
    `SELECT 1 FROM transactions WHERE registry_id = $1
     AND exercise_id IS NULL
     AND (
       user_paid::text = $2
       OR split_json @> jsonb_build_object(
            'splits', jsonb_build_array(jsonb_build_object('userId', $2))
          )
     )`,
    [registryId, entityId],
  );
  if (txCheck.rows.length > 0) return false;

  const entities = await getEntities(registryId, userId);
  const idx = entities.findIndex((e) => e.id === entityId);
  if (idx === -1) return false;
  entities.splice(idx, 1);
  const result = await query(
    `UPDATE registries SET entities_json = $1, last_modified = NOW() WHERE id = $2
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = registries.id AND rm.user_id = $3
     )`,
    [JSON.stringify(entities), registryId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getRegistryMemberCount(
  registryId: string,
  q: QueryFn = query,
): Promise<number> {
  const result = await q("SELECT COUNT(*) as cnt FROM registry_members WHERE registry_id = $1", [
    registryId,
  ]);
  return parseInt(result.rows[0].cnt as string);
}

export async function setDefaultSplit(
  registryId: string,
  splits: { userId: string; percentage: number }[],
  ownerId: string,
): Promise<boolean> {
  const memberCount = await getRegistryMemberCount(registryId);
  // Owner-scoped: the UPDATE no-ops unless `ownerId` owns the registry.
  const result = await query(
    `UPDATE registries SET default_split_json = $1, default_split_member_count = $2, last_modified = NOW() WHERE id = $3
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = registries.id AND rm.user_id = $4 AND rm.role = 'owner'
     )`,
    [JSON.stringify({ splits }), memberCount, registryId, ownerId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function clearDefaultSplit(registryId: string, q: QueryFn = query): Promise<void> {
  await q(
    "UPDATE registries SET default_split_json = NULL, default_split_member_count = NULL, last_modified = NOW() WHERE id = $1",
    [registryId],
  );
}

/**
 * Owner-scoped variant of {@link clearDefaultSplit} for user-facing routes.
 * Returns `false` when `ownerId` doesn't own the registry (no-op).
 */
export async function clearDefaultSplitForOwner(
  registryId: string,
  ownerId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE registries SET default_split_json = NULL, default_split_member_count = NULL, last_modified = NOW() WHERE id = $1
     AND EXISTS (
       SELECT 1 FROM registry_members rm
       WHERE rm.registry_id = registries.id AND rm.user_id = $2 AND rm.role = 'owner'
     )`,
    [registryId, ownerId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function invalidateDefaultSplitIfNeeded(
  registryId: string,
  q: QueryFn = query,
): Promise<void> {
  const result = await q("SELECT default_split_member_count FROM registries WHERE id = $1", [
    registryId,
  ]);
  if (result.rows.length === 0) return;
  const savedCount = result.rows[0].default_split_member_count as number | null;
  if (savedCount === null) return;

  const currentCount = await getRegistryMemberCount(registryId, q);
  if (currentCount !== savedCount) {
    await clearDefaultSplit(registryId, q);
  }
}

export async function createInvitation(
  registryId: string,
  createdBy: string,
  expiresAt?: Date,
  maxUses?: number,
): Promise<{ id: string; code: string; expiresAt: Date | null }> {
  const code = generateInviteCode();
  // Invitations created without an explicit expiry (e.g. from the UI) default
  // to 7 days instead of being valid forever.
  const effectiveExpiresAt = expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const result = await query(
    `INSERT INTO invitations (registry_id, code, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [registryId, code, createdBy, effectiveExpiresAt.toISOString(), maxUses ?? null],
  );
  const row = result.rows[0];
  await query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5)`,
    [createdBy, "invite_created", "invitation", row.id, JSON.stringify({ code })],
  );
  return {
    id: row.id as string,
    code: row.code as string,
    expiresAt: effectiveExpiresAt,
  };
}

export async function getInvitationByCode(code: string): Promise<{
  id: string;
  registryId: string;
  registryName: string;
  code: string;
  expiresAt: Date | null;
  maxUses: number | null;
  currentUses: number;
  revokedAt: Date | null;
} | null> {
  const result = await query(
    `SELECT i.*, r.name as registry_name FROM invitations i JOIN registries r ON r.id = i.registry_id WHERE i.code = $1`,
    [code.toUpperCase()],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    registryId: row.registry_id as string,
    registryName: row.registry_name as string,
    code: row.code as string,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    maxUses: (row.max_uses as number) ?? null,
    currentUses: row.current_uses as number,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
  };
}

export async function useInvitation(code: string, userId: string): Promise<string> {
  const invitation = await getInvitationByCode(code);
  if (!invitation) throw new Error("Invitation not found");
  if (invitation.revokedAt) throw new Error("Invitation has been revoked");
  if (invitation.expiresAt && invitation.expiresAt < new Date()) {
    throw new Error("Invitation has expired");
  }

  const existing = await query(
    "SELECT registry_id FROM registry_members WHERE registry_id = $1 AND user_id = $2",
    [invitation.registryId, userId],
  );
  if (existing.rows.length > 0) {
    return invitation.registryId;
  }

  // Free plan: cap on members per registry.
  //
  // Placement matters: this runs AFTER the invitation-validity checks above
  // but BEFORE the current_uses claim and member INSERT (which share one
  // transaction) — so a full group never consumes an invitation use (the
  // joiner can retry once the owner upgrades, without wasting the code).
  //
  // The check is on the TARGET registry's plan, never the joiner's:
  // "joining groups is never gated" is a product invariant. A free-plan user
  // joining a Pro group is fine; only the group's own plan sets its limits.
  //
  // GroupFullError is a typed error — the join route maps it (via
  // instanceof) to a localized 402 {code:'upgrade_required'} payload, so a
  // plain Error message never leaks to the client as a raw string.
  //
  // TOCTOU: two racing joins could both pass the count and land N+1 members.
  // Accepted risk (product limit, not a security boundary). The atomic
  // invitation-uses claim is the check that MUST be race-proof, and it
  // already is (UPDATE ... WHERE current_uses < max_uses).
  const planInfo = await getRegistryPlan(invitation.registryId);
  if (planInfo && !planInfo.isPro) {
    const members = await countRegistryMembers(invitation.registryId);
    if (members >= planInfo.limits.maxMembers) {
      throw new GroupFullError();
    }
  }

  return await withTransaction(async (q) => {
    // Atomic check-and-increment: the UPDATE itself enforces not-revoked and
    // max-uses, so concurrent joins can't overshoot max_uses (the read above
    // only exists to give precise error messages).
    const claimed = await q(
      `UPDATE invitations SET current_uses = current_uses + 1
       WHERE id = $1 AND revoked_at IS NULL
         AND (max_uses IS NULL OR current_uses < max_uses)
       RETURNING id`,
      [invitation.id],
    );
    if (claimed.rows.length === 0) {
      throw new Error("Invitation has reached max uses");
    }

    await q(
      "INSERT INTO registry_members (registry_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
      [invitation.registryId, userId],
    );

    await invalidateDefaultSplitIfNeeded(invitation.registryId, q);

    await q(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, "invite_used", "invitation", invitation.id, JSON.stringify({ code })],
    );

    // The member list is part of every registry snapshot — a new member must
    // invalidate existing members' cached dashboards.
    await touchRegistryStamp(invitation.registryId, q);

    return invitation.registryId;
  });
}

export async function getInvitationsForRegistry(registryId: string): Promise<
  {
    id: string;
    code: string;
    expiresAt: Date | null;
    maxUses: number | null;
    currentUses: number;
    revokedAt: Date | null;
    createdAt: Date;
  }[]
> {
  const result = await query(
    "SELECT * FROM invitations WHERE registry_id = $1 ORDER BY created_at DESC",
    [registryId],
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    code: row.code as string,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    maxUses: (row.max_uses as number) ?? null,
    currentUses: row.current_uses as number,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }));
}

export async function revokeInvitation(invitationId: string, userId: string): Promise<boolean> {
  // Ownership-scoped: the UPDATE no-ops unless `userId` owns the registry the
  // invitation belongs to, so a bare invitation id can't be revoked across
  // registries. Returns false in that case (and when already revoked).
  const result = await query(
    `UPDATE invitations SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL
     AND registry_id IN (
       SELECT rm.registry_id FROM registry_members rm
       WHERE rm.user_id = $2 AND rm.role = 'owner'
         AND rm.registry_id = invitations.registry_id
     )`,
    [invitationId, userId],
  );
  if ((result.rowCount ?? 0) === 0) return false;
  await query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5)`,
    [userId, "invite_revoked", "invitation", invitationId, JSON.stringify({})],
  );
  return true;
}

export async function getRegistryStamp(registryId: string): Promise<string | null> {
  const result = await query("SELECT last_modified FROM registries WHERE id = $1", [registryId]);
  if (result.rows.length === 0) return null;
  const lm = result.rows[0].last_modified;
  return lm ? new Date(lm as string).toISOString() : null;
}
