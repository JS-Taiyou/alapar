/**
 * Pure SQL-fragment builders for dynamic queries.
 *
 * Extracted from `lib/store.ts` so the fiddly placeholder/SET-clause math is
 * unit-testable without a database. These produce SQL *fragments* (strings)
 * plus the matching positional parameter arrays — they never touch the DB.
 */
import type { Transaction } from "./types";

/**
 * Build a Postgres multi-row VALUES placeholder string.
 *
 * For `rows` rows of `cols` columns each, produces e.g. for 2 rows × 3 cols:
 *   `($1, $2, $3), ($4, $5, $6)`
 *
 * @param rowCount number of value tuples
 * @param cols     number of placeholders per tuple
 * @returns the placeholder fragment (no leading "VALUES")
 */
export function buildBatchPlaceholders(rowCount: number, cols: number): string {
  return Array.from(
    { length: rowCount },
    (_, rowIdx) =>
      `(${Array.from({ length: cols }, (_, c) => `$${rowIdx * cols + c + 1}`).join(", ")})`,
  ).join(", ");
}

/**
 * Build a dynamic `SET` clause for a transaction UPDATE.
 *
 * Only fields present (i.e. `!== undefined`) in `data` are included; the rest
 * are left untouched. Returns `{ sets, values }` where `sets` is an array of
 * `"col = $N"` fragments (1-indexed placeholders) and `values` is the matching
 * parameter array. Returns empty arrays when nothing is to be updated.
 *
 * Mirrors the field list in `store.updateTransaction` exactly. `splitJson` is
 * serialized to a JSON string to match the INSERT path.
 *
 * @returns `{ sets, values }` — both empty when `data` has no settable fields.
 */
export function buildTransactionUpdateSets(data: Partial<Transaction>): {
  sets: string[];
  values: unknown[];
} {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (data.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(data.description);
  }
  if (data.amount !== undefined) {
    sets.push(`amount = $${idx++}`);
    values.push(data.amount);
  }
  if (data.originalAmount !== undefined) {
    sets.push(`original_amount = $${idx++}`);
    values.push(data.originalAmount);
  }
  if (data.type !== undefined) {
    sets.push(`type = $${idx++}`);
    values.push(data.type);
  }
  if (data.notes !== undefined) {
    sets.push(`notes = $${idx++}`);
    values.push(data.notes);
  }
  if (data.splitJson !== undefined) {
    sets.push(`split_json = $${idx++}`);
    values.push(JSON.stringify(data.splitJson));
  }
  if (data.userPaid !== undefined) {
    sets.push(`user_paid = $${idx++}`);
    values.push(data.userPaid);
  }
  if (data.installmentCurrent !== undefined) {
    sets.push(`installment_current = $${idx++}`);
    values.push(data.installmentCurrent);
  }
  if (data.installmentTotal !== undefined) {
    sets.push(`installment_total = $${idx++}`);
    values.push(data.installmentTotal);
  }
  if (data.recurringDisabled !== undefined) {
    sets.push(`recurring_disabled = $${idx++}`);
    values.push(data.recurringDisabled);
  }
  if (data.relatedTransactionId !== undefined) {
    sets.push(`related_transaction_id = $${idx++}`);
    values.push(data.relatedTransactionId);
  }
  return { sets, values };
}
