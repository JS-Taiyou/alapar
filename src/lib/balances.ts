/**
 * Per-transaction balance delta computation.
 *
 * All arithmetic is done in integer cents to eliminate floating-point residue.
 * Each delta is converted back to dollars only at the return boundary, so when
 * persisted as `NUMERIC(12,2)` and later summed, the result is exact.
 *
 * Formula (mirrors `calculateBalance`, generalized to all affected users):
 *
 * For expenses (`unico`, `parcialidad`, `recurrente`):
 *   - payer: `+perInstallmentTotal - ownShare` (or `+perInstallmentTotal` if
 *     the payer is not in the split)
 *   - each non-payer in the split: `-theirShare`
 *
 * For payments/adjustments (`pago`, `ajuste`):
 *   - payer: `+originalAmount`
 *   - recipient (first split entry): `-originalAmount`
 */

import type { Transaction } from "./types";
import { fromCents, toCents } from "./splits";

export interface BalanceDelta {
  userId: string;
  amount: number;
}

/**
 * Compute the signed, cent-exact balance delta for each user affected by a
 * single transaction. All math is in integer cents internally.
 *
 * @returns array of `{ userId, amount }` — one per affected user. Users with a
 * zero delta are excluded. The payer is always included if they have a non-zero
 * delta (even when not in the split).
 */
export function computeDeltas(tx: Transaction): BalanceDelta[] {
  const deltas: BalanceDelta[] = [];

  if (tx.type === "pago" || tx.type === "ajuste") {
    const amountCents = toCents(tx.originalAmount);
    // Payer is credited the full amount.
    deltas.push({ userId: tx.userPaid, amount: fromCents(amountCents) });
    // Recipient (first split entry) is debited.
    const recipient = tx.splitJson?.splits?.[0];
    if (recipient && recipient.userId !== tx.userPaid) {
      deltas.push({
        userId: recipient.userId,
        amount: fromCents(-amountCents),
      });
    }
    return deltas;
  }

  // Expense (unico, parcialidad, recurrente) — all math in cents.
  const divisor = tx.type === "parcialidad" && tx.installmentTotal
    ? tx.installmentTotal
    : 1;
  const perTotalCents = Math.round(toCents(tx.originalAmount) / divisor);

  const splits = tx.splitJson?.splits ?? [];
  for (const split of splits) {
    const shareCents = Math.round(toCents(split.amount) / divisor);
    if (split.userId === tx.userPaid) {
      deltas.push({
        userId: split.userId,
        amount: fromCents(perTotalCents - shareCents),
      });
    } else {
      deltas.push({ userId: split.userId, amount: fromCents(-shareCents) });
    }
  }

  const payerInSplit = splits.some((s) => s.userId === tx.userPaid);
  if (!payerInSplit) {
    deltas.push({ userId: tx.userPaid, amount: fromCents(perTotalCents) });
  }

  return deltas;
}
