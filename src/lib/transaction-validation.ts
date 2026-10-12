/**
 * Shared parsing + validation for the transaction create/update form.
 *
 * The POST and PUT routes receive the same FormData shape; every rule here
 * runs before any DB write on both paths so neither can drift. The money
 * rules are the security boundary for balance integrity: `computeDeltas`
 * persists whatever split amounts it is given, so a hostile client must not
 * be able to store splits that don't add up to the transaction they belong
 * to (that would silently create or destroy group money).
 */
import type { TransactionSplit } from "./types";

export interface TransactionFormData {
  description: string;
  amount: number;
  originalAmount: number;
  type: "unico" | "parcialidad" | "recurrente" | "pago" | "ajuste";
  notes: string;
  userPaid: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  relatedTransactionId: string | null;
  splitJson: TransactionSplit;
  transactionPaymentEntries: { expenseId: string; amount: number }[] | undefined;
}

export type ParseTransactionFormResult =
  | { ok: true; data: TransactionFormData }
  | { ok: false; error: string };

const TRANSACTION_TYPES = new Set(["unico", "parcialidad", "recurrente", "pago", "ajuste"]);

/** NUMERIC(12,2) headroom; anything above is not a real amount a user types. */
const MAX_AMOUNT = 999_999_999.99;
const MAX_SPLITS = 50;
const MAX_PAYMENT_ENTRIES = 100;
const MAX_INSTALLMENTS = 1200;

/**
 * How far split amounts may drift from the transaction total. The client's
 * percentage/fixed builders round each share independently, so a few cents of
 * drift is normal rounding — but tens of dollars means the payload is wrong
 * (or hostile) and must not reach `computeDeltas`. Scales with participant
 * count, capped.
 */
function splitSumTolerance(splitCount: number): number {
  return Math.max(0.02, Math.min(0.1, 0.02 * splitCount));
}

function parseAmount(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const v = parseFloat(raw);
  if (!isFinite(v) || v <= 0 || v > MAX_AMOUNT) return null;
  return v;
}

export function parseTransactionForm(form: FormData): ParseTransactionFormResult {
  const description = (form.get("description") ?? "") as string;
  if (!description || !description.trim()) {
    return { ok: false, error: "Descripción requerida" };
  }

  const amount = parseAmount(form.get("amount") as string);
  if (amount === null) {
    return { ok: false, error: "Monto inválido" };
  }
  const originalAmountRaw = form.get("originalAmount") as string;
  const originalAmount = originalAmountRaw ? parseAmount(originalAmountRaw) : amount;
  if (originalAmount === null) {
    return { ok: false, error: "Monto original inválido" };
  }

  const type = ((form.get("type") as string) || "unico") as TransactionFormData["type"];
  if (!TRANSACTION_TYPES.has(type)) {
    return { ok: false, error: "Tipo de transacción inválido" };
  }

  const userPaid = form.get("userPaid") as string;
  if (!userPaid) {
    return { ok: false, error: "Usuario pagador requerido" };
  }

  const notes = (form.get("notes") as string) || "";
  const relatedTransactionId = (form.get("relatedTransactionId") as string) || null;

  let installmentCurrent: number | null = null;
  let installmentTotal: number | null = null;
  const icRaw = form.get("installmentCurrent") as string | null;
  const itRaw = form.get("installmentTotal") as string | null;
  if (icRaw) installmentCurrent = parseInt(icRaw, 10);
  if (itRaw) installmentTotal = parseInt(itRaw, 10);
  if (installmentTotal !== null) {
    if (
      !Number.isInteger(installmentTotal) ||
      installmentTotal < 1 ||
      installmentTotal > MAX_INSTALLMENTS
    ) {
      return { ok: false, error: "Número de parcialidades inválido" };
    }
  }
  if (installmentCurrent !== null) {
    if (
      !Number.isInteger(installmentCurrent) ||
      installmentCurrent < 1 ||
      (installmentTotal !== null && installmentCurrent > installmentTotal)
    ) {
      return { ok: false, error: "Parcialidad actual inválida" };
    }
  }

  let splitJson: TransactionSplit;
  try {
    splitJson = JSON.parse((form.get("splitJson") as string) ?? "{}");
  } catch {
    return { ok: false, error: "Split JSON inválido" };
  }
  if (!splitJson || typeof splitJson !== "object" || !Array.isArray(splitJson.splits)) {
    return { ok: false, error: "Split JSON inválido" };
  }
  if (splitJson.splits.length > MAX_SPLITS) {
    return { ok: false, error: "Demasiados participantes en el split" };
  }
  for (const split of splitJson.splits) {
    if (
      !split ||
      typeof split !== "object" ||
      typeof split.userId !== "string" ||
      split.userId === ""
    ) {
      return { ok: false, error: "Participante inválido en el split" };
    }
    if (
      typeof split.amount !== "number" ||
      !isFinite(split.amount) ||
      split.amount < 0 ||
      split.amount > MAX_AMOUNT
    ) {
      return { ok: false, error: "Monto inválido en el split" };
    }
    if (
      typeof split.percentage !== "number" ||
      !isFinite(split.percentage) ||
      split.percentage < 0 ||
      split.percentage > 100
    ) {
      return { ok: false, error: "Porcentaje inválido en el split" };
    }
  }

  // Balance-integrity invariant: for expenses, the split shares must account
  // for the whole transaction (within rounding tolerance). Payments/adjustments
  // only use splits[0] as the recipient, so no sum applies there.
  if (type === "unico" || type === "parcialidad" || type === "recurrente") {
    const splitSum = splitJson.splits.reduce((s, sp) => s + sp.amount, 0);
    const tolerance = splitSumTolerance(splitJson.splits.length);
    if (Math.abs(splitSum - originalAmount) > tolerance) {
      return { ok: false, error: "El split debe sumar el monto total" };
    }
  }

  let transactionPaymentEntries: { expenseId: string; amount: number }[] | undefined;
  const tpRaw = form.get("transactionPayments") as string | null;
  if (tpRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(tpRaw);
    } catch {
      return { ok: false, error: "transactionPayments JSON inválido" };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "transactionPayments JSON inválido" };
    }
    if (parsed.length > MAX_PAYMENT_ENTRIES) {
      return { ok: false, error: "Demasiados pagos vinculados" };
    }
    for (const entry of parsed) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as { expenseId?: unknown }).expenseId !== "string" ||
        (entry as { expenseId: string }).expenseId === ""
      ) {
        return { ok: false, error: "Pago vinculado inválido" };
      }
      const entryAmount = (entry as { amount?: unknown }).amount;
      if (
        typeof entryAmount !== "number" ||
        !isFinite(entryAmount) ||
        entryAmount <= 0 ||
        entryAmount > MAX_AMOUNT
      ) {
        return { ok: false, error: "Monto inválido en pago vinculado" };
      }
    }
    // A payment's linked allocations can cover at most the payment itself.
    const allocSum = parsed.reduce((s: number, e: { amount: number }) => s + e.amount, 0);
    if (allocSum > originalAmount + 0.02) {
      return { ok: false, error: "Los pagos vinculados exceden el monto" };
    }
    transactionPaymentEntries = parsed as {
      expenseId: string;
      amount: number;
    }[];
  }

  return {
    ok: true,
    data: {
      description,
      amount,
      originalAmount,
      type,
      notes,
      userPaid,
      installmentCurrent,
      installmentTotal,
      relatedTransactionId,
      splitJson,
      transactionPaymentEntries,
    },
  };
}
