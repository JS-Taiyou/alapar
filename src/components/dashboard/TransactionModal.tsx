import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  SplitEntry,
  SplitMode,
  TransactionPayment,
  TransactionSplit,
} from "../../lib/types";
import type { EnrichedTransaction } from "../../lib/types";
import {
  buildEqualSplit,
  buildFixedSplit,
  buildPercentageSplit,
  checkSplitSum,
  completePercentages,
  computeDefaultPercentages,
  equalPercentages,
  isEvenPercentages,
  isEqualSplit,
  percentagesFromAmounts,
  resolveTransactionSplit,
  untouchedSplit,
} from "../../lib/calculations";
import { formatMoney, initials, sanitizeDecimal, sanitizeInteger } from "../../lib/format";
import Modal from "../ui/Modal";
import { showUpgradeToast } from "../ui/toast-store";
import { formatDate, type Locale, t as translate } from "../../lib/i18n";

interface TransactionModalProps {
  isOpen: boolean;
  editingId: string | null;
  modalMode: "expense" | "payment";
  transactions: EnrichedTransaction[];
  users: Participant[];
  currentUserId: string;
  registryId: string;
  balanceEntries: BalanceBreakdownEntry[];
  defaultSplit: DefaultSplit | null;
  entityIds: Set<string>;
  transactionPayments: TransactionPayment[];
  /** The book's line for leftover cents, front first. The form predicts the server's deal with it. */
  remainderQueue: string[];
  onRecalculate: () => void;
  /**
   * Receives the registry's fresh `last_modified` returned by mutation
   * endpoints, so the caller can label its cached snapshot with the version
   * its own write produced (a stale label forces a redundant refetch on the
   * next sync). Called with null when the server reports no stamp.
   */
  onServerStamp?: (stamp: string | null) => void;
  /** A save that dealt a split reports the book's line as it left it (the demo keeps its own). */
  onRemainderQueueChange: (queue: string[]) => void;
  /** Replace the transaction list (optimistic write, server merge, rollback). */
  onTransactionsChange: (transactions: EnrichedTransaction[]) => void;
  /** Replace the payment-link list (optimistic write, server merge, rollback). */
  onTransactionPaymentsChange: (transactionPayments: TransactionPayment[]) => void;
  /** Close the modal and clear the editing target. */
  onClose: () => void;
  /** Reopen after a rejected submit, restoring the editing target. */
  onReopen: (editingId: string | null) => void;
  isDemo?: boolean;
  locale?: Locale;
}

type TransactionType = "unico" | "parcialidad" | "recurrente" | "pago" | "ajuste";

/** Money as the rest of the app shows it: two decimals, grouped, `$` on the left. */
const money = (amount: number) => `$${formatMoney(amount)}`;

interface EligibleTransaction {
  id: string;
  description: string;
  userPaid: string;
  paidByUser: string;
  originalDebt: number;
  remainingDebt: number;
  createdAt: Date;
}

export default function TransactionModal(props: TransactionModalProps) {
  const transactions = props.transactions;
  const users = props.users;
  const currentUserId = props.currentUserId;
  const registryId = props.registryId;
  const defaultSplit = props.defaultSplit;
  const transactionPayments = props.transactionPayments;
  const userIds = users.map((u) => u.id);
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState(0);
  const [amountDisplay, setAmountDisplay] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [expenseType, setExpenseType] = useState<TransactionType>("unico");
  const [installmentCurrent, setInstallmentCurrent] = useState(1);
  const [installmentTotal, setInstallmentTotal] = useState(12);
  const [installmentTotalDisplay, setInstallmentTotalDisplay] = useState("12");
  const [installmentInputMode, setInstallmentInputMode] = useState<"total" | "installment">(
    "total",
  );
  const [installmentAmount, setInstallmentAmount] = useState(0);
  const [installmentAmountDisplay, setInstallmentAmountDisplay] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("auto");
  // The book's line decides every cent that cannot be divided. The server
  // keeps it; this is the copy its last answer (or the page) delivered.
  const line = props.remainderQueue;
  // The split of the expense being edited. getSplits() keeps returning it
  // verbatim for as long as the form shows it unchanged (see untouchedSplit).
  const [savedSplit, setSavedSplit] = useState<{ total: number; splits: SplitEntry[] } | null>(
    null,
  );
  const [userPaid, setUserPaid] = useState(currentUserId);
  const [paymentRecipient, setPaymentRecipient] = useState<string>(
    () => users.find((u) => u.id !== currentUserId)?.id ?? "",
  );
  const [percentages, setPercentages] = useState<Record<string, number>>(() =>
    computeDefaultPercentages(users, defaultSplit, line),
  );
  const [fixedAmounts, setFixedAmounts] = useState<Record<string, number>>(() =>
    fixedAmountsFrom([]),
  );
  const [linkToTransaction, setLinkToTransaction] = useState(false);
  const [selectedRelatedTxId, setSelectedRelatedTxId] = useState<string | null>(null);
  const [relatedTxSearch, setRelatedTxSearch] = useState("");
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  const isEditing = props.editingId !== null;
  // Editing an expense, as opposed to a payment: its split is the saved one.
  const isEditingExpense = props.editingId !== null && props.modalMode !== "payment";

  const hasInitialized = useRef(false);
  // Set when the modal is reopened after a failed submit: the form state
  // still holds everything the user typed, so the reset/populate path must be
  // skipped or their input would be lost.
  const reopenWithoutReset = useRef(false);

  useEffect(() => {
    if (!props.isOpen) {
      hasInitialized.current = false;
      return;
    }
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    if (reopenWithoutReset.current) {
      reopenWithoutReset.current = false;
      return;
    }

    const txId = props.editingId;
    if (txId) {
      const tx = transactions.find((t) => t.id === txId);
      if (tx) populateEdit(tx);
    } else {
      resetForm();
    }
    // Runs on open transitions only (the hasInitialized guard makes other
    // tracked changes no-ops in the signals version).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isOpen]);

  useEffect(() => {
    const count = selectedExpenseIds.length;
    if (count === 0) return;
    const form = formRef.current;
    if (!form) return;
    requestAnimationFrame(() => {
      form.scrollTo({ top: form.scrollHeight, behavior: "smooth" });
    });
  }, [selectedExpenseIds]);

  useEffect(() => {
    if (amount === 0 && linkToTransaction) {
      setLinkToTransaction(false);
      setSelectedRelatedTxId(null);
      setSelectedExpenseIds([]);
    }
  }, [amount, linkToTransaction]);

  function buildDefaultPercentages(): Record<string, number> {
    return computeDefaultPercentages(users, defaultSplit, line);
  }

  /** Monto Fijo inputs for every member: each saved share, 0 outside the split. */
  function fixedAmountsFrom(splits: SplitEntry[]): Record<string, number> {
    return Object.fromEntries(
      users.map((u) => [u.id, splits.find((s) => s.userId === u.id)?.amount ?? 0]),
    );
  }

  /** Percentages that reproduce a split (even ones while there is no amount). */
  function percentagesFor(splits: SplitEntry[]): Record<string, number> {
    const total = Math.abs(amount);
    return total > 0 ? percentagesFromAmounts(total, splits) : equalPercentages(userIds, line);
  }

  function saveLastSplitConfig() {
    if (props.modalMode === "payment") return;
    const key = `lastSplit_${registryId}`;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          percentages: percentages,
          splitMode: splitMode,
          userPaid: userPaid,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* ignore storage errors */
    }
  }

  function loadLastSplitConfig(): {
    percentages: Record<string, number>;
    splitMode?: string;
    userPaid: string;
  } | null {
    const key = `lastSplit_${registryId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.savedAt) {
        localStorage.removeItem(key);
        return null;
      }
      const savedDate = new Date(parsed.savedAt);
      const today = new Date();
      if (savedDate.toDateString() !== today.toDateString()) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function resetForm() {
    setAmount(0);
    setAmountDisplay("");
    setDescription("");
    setNotes("");
    setNotesOpen(false);
    setSavedSplit(null);
    setExpenseType("unico");
    setInstallmentCurrent(1);
    setInstallmentTotal(12);
    setInstallmentTotalDisplay("12");
    setInstallmentInputMode("total");
    setInstallmentAmount(0);
    setInstallmentAmountDisplay("");
    setPaymentRecipient(users.find((u) => u.id !== currentUserId)?.id ?? "");
    setLinkToTransaction(false);
    setSelectedRelatedTxId(null);
    setRelatedTxSearch("");
    setSelectedExpenseIds([]);

    // The remembered split belongs to expenses. Replaying its payer in a
    // payment could select the same person as payer and as recipient.
    const lastConfig = props.modalMode === "payment" ? null : loadLastSplitConfig();
    if (lastConfig) {
      if (lastConfig.splitMode) {
        setSplitMode(lastConfig.splitMode as SplitMode);
      } else setSplitMode("percentage");
      // An even split remembered from the last expense is dealt by the line
      // again: its odd hundredth of a percent has to follow the turn.
      setPercentages(
        isEvenPercentages(lastConfig.percentages)
          ? equalPercentages(userIds, line)
          : completePercentages(lastConfig.percentages),
      );
      setUserPaid(lastConfig.userPaid);
    } else {
      setUserPaid(currentUserId);
      if (defaultSplit && defaultSplit.splits.length === users.length) {
        setSplitMode("percentage");
        setPercentages(buildDefaultPercentages());
      } else {
        setSplitMode("auto");
        setPercentages(buildDefaultPercentages());
      }
    }
    // Fixed amounts belong to the expense they were typed for, whatever
    // mode the next form opens in.
    setFixedAmounts(fixedAmountsFrom([]));
  }

  function populateEdit(tx: EnrichedTransaction) {
    setAmount(tx.originalAmount);
    setAmountDisplay(tx.originalAmount.toString());
    setDescription(tx.description);
    setNotes(tx.notes || "");
    setNotesOpen(!!tx.notes);
    if (tx.type !== "pago") setExpenseType(tx.type);
    setInstallmentCurrent(tx.installmentCurrent ?? 1);
    setInstallmentTotal(tx.installmentTotal ?? 12);
    setInstallmentTotalDisplay((tx.installmentTotal ?? 12).toString());
    setInstallmentInputMode("total");
    const roundedInstallment = tx.installmentTotal
      ? Math.round((tx.originalAmount / tx.installmentTotal) * 100) / 100
      : 0;
    setInstallmentAmount(roundedInstallment);
    setInstallmentAmountDisplay(roundedInstallment ? roundedInstallment.toString() : "");
    setUserPaid(tx.userPaid);

    if (tx.type === "pago") {
      setSavedSplit(null);
      const recipientSplit = tx.splitJson.splits[0];
      if (recipientSplit) {
        setPaymentRecipient(recipientSplit.userId);
      }
      const pagoTps = transactionPayments.filter((tp) => tp.pagoId === tx.id);
      if (pagoTps.length > 0) {
        setLinkToTransaction(true);
        setSelectedExpenseIds(pagoTps.map((tp) => tp.expenseId));
        setSelectedRelatedTxId(null);
      } else if (tx.relatedTransactionId) {
        setLinkToTransaction(true);
        setSelectedExpenseIds([tx.relatedTransactionId]);
        setSelectedRelatedTxId(tx.relatedTransactionId);
      } else {
        setLinkToTransaction(false);
        setSelectedExpenseIds([]);
        setSelectedRelatedTxId(null);
      }
    } else {
      const splits = tx.splitJson.splits;
      setSavedSplit({ total: tx.originalAmount, splits });
      if (isEqualSplit(splits, userIds)) {
        setSplitMode("auto");
      } else {
        // Any other saved split opens in Monto Fijo with its real amounts,
        // members outside it at 0, instead of being re-split evenly.
        setSplitMode("fixed");
        setFixedAmounts(fixedAmountsFrom(splits));
      }
    }
  }

  /**
   * The split for the form as it stands, dealt the way the server will deal
   * it (`resolveTransactionSplit`): Auto and Porcentaje in whole cents against
   * the book's line, Monto Fijo as typed. `line` is the book's line once this
   * split is saved — what the demo keeps and the server sends back.
   */
  function dealSplit(): { splits: SplitEntry[]; line: string[] } {
    const total = Math.abs(amount);
    // An edit keeps the saved entries for as long as the form shows them.
    const saved = savedSplit;
    if (saved) {
      const untouched = untouchedSplit(saved, {
        total,
        mode: splitMode,
        userIds,
        fixedAmounts,
      });
      if (untouched) return { splits: untouched, line };
    }
    if (splitMode === "auto") {
      const sent = buildEqualSplit(total, userIds, line).splits;
      const dealt = resolveTransactionSplit("auto", total, { splits: sent }, line);
      return { splits: dealt.split.splits, line: dealt.line };
    }
    if (splitMode === "percentage") {
      const sent = buildPercentageSplit(
        total,
        users.map((u) => ({
          userId: u.id,
          percentage: percentages[u.id] ?? 0,
        })),
      ).splits;
      // A split that leaves part of the expense unassigned is shown as it
      // falls, so "Faltan…" has a true amount to name. Only one that accounts
      // for the whole expense is dealt to the cent.
      if (
        !checkSplitSum(
          total,
          sent.map((s) => s.amount),
        ).ok
      )
        return { splits: sent, line };
      const dealt = resolveTransactionSplit("percentage", total, { splits: sent }, line);
      return { splits: dealt.split.splits, line: dealt.line };
    }
    return {
      splits: buildFixedSplit(
        total,
        users.map((u) => ({
          userId: u.id,
          amount: fixedAmounts[u.id] ?? 0,
        })),
      ).splits,
      line,
    };
  }

  function getSplits(): SplitEntry[] {
    return dealSplit().splits;
  }

  function computeAllocation(
    totalAmount: number,
    expenseIds: string[],
  ): Array<{ expenseId: string; amount: number }> {
    if (expenseIds.length === 0 || totalAmount <= 0) return [];
    const expenses = expenseIds
      .map((id) => eligibleTransactions.find((e) => e.id === id))
      .filter((e): e is EligibleTransaction => e !== undefined)
      .sort((a, b) => a.remainingDebt - b.remainingDebt);

    const result: Array<{ expenseId: string; amount: number }> = [];
    let remaining = totalAmount;
    for (const exp of expenses) {
      if (remaining <= 0) break;
      const alloc = Math.min(remaining, exp.remainingDebt);
      result.push({ expenseId: exp.id, amount: Math.round(alloc * 100) / 100 });
      remaining -= alloc;
    }
    return result;
  }

  function enforceSelectionConstraint() {
    const ids = selectedExpenseIds;
    if (ids.length <= 1) return;
    const totalAmount = Math.abs(amount);
    const expenses = ids
      .map((id) => eligibleTransactions.find((e) => e.id === id))
      .filter((e): e is EligibleTransaction => e !== undefined)
      .sort((a, b) => a.remainingDebt - b.remainingDebt);

    while (expenses.length > 1) {
      const nMinus1Sum = expenses
        .slice(0, expenses.length - 1)
        .reduce((s, e) => s + e.remainingDebt, 0);
      if (totalAmount >= nMinus1Sum) break;
      const removed = expenses.pop()!;
      setSelectedExpenseIds((prev) => prev.filter((id) => id !== removed.id));
    }
  }

  function handleAmountChange(raw: string) {
    const sanitized = sanitizeDecimal(raw);
    const newVal = parseFloat(sanitized) || 0;

    // Changing the amount of a saved expense moves it to Porcentaje with the
    // shares it already has, so the split follows the new total.
    if (isEditingExpense && Math.abs(newVal - amount) > 0.001) {
      setPercentages(percentagesFor(getSplits()));
      setSplitMode("percentage");
    }

    setAmount(newVal);
    setAmountDisplay(sanitized);
    if (props.modalMode === "payment" && linkToTransaction) {
      enforceSelectionConstraint();
    }
    return sanitized;
  }

  function handleInstallmentAmountChange(raw: string) {
    const sanitized = sanitizeDecimal(raw);
    const newVal = parseFloat(sanitized) || 0;
    setInstallmentAmount(newVal);
    setInstallmentAmountDisplay(sanitized);
    const total = Math.round(newVal * installmentTotal * 100) / 100;

    if (isEditingExpense && Math.abs(total - amount) > 0.001) {
      setPercentages(percentagesFor(getSplits()));
      setSplitMode("percentage");
    }

    setAmount(total);
    return sanitized;
  }

  function totalPercentage(): number {
    return Object.values(percentages).reduce((s, v) => s + v, 0);
  }

  /**
   * Percentage + complement in ONE functional update. The old code did two
   * sequential setPercentages calls where the complement read STALE state
   * (React batches; Preact signals updated synchronously) — every keystroke
   * was overwritten by the auto-complement computed from the PREVIOUS value,
   * making the inputs completely unresponsive.
   */
  function updatePercentage(userId: string, raw: string) {
    const v = Math.min(Math.max(parseFloat(raw) || 0, 0), 100);
    setPercentages((prev) => {
      const next = { ...prev, [userId]: v };
      if (users.length === 2) {
        const otherId = users.find((u) => u.id !== userId)?.id;
        if (otherId) {
          next[otherId] = Math.max(0, Math.round((100 - v) * 100) / 100);
        }
      }
      return next;
    });
  }

  /** Fixed amount + complement in ONE functional update (same fix). */
  function updateFixedAmount(userId: string, raw: string) {
    const total = Math.abs(amount);
    const v = Math.min(Math.max(parseFloat(raw) || 0, 0), total);
    setFixedAmounts((prev) => {
      const next = { ...prev, [userId]: v };
      if (users.length === 2) {
        const otherId = users.find((u) => u.id !== userId)?.id;
        if (otherId) {
          next[otherId] = Math.max(0, Math.round((total - v) * 100) / 100);
        }
      }
      return next;
    });
  }

  function setAutoSplit() {
    setSplitMode("auto");
    setPercentages(equalPercentages(userIds, line));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter in any field submits too, so the guard lives here, not only on
    // the disabled button.
    if (submitting || splitBlocked) return;
    setSubmitting(true);
    try {
      let splitJson: TransactionSplit;
      // Dealt once: the optimistic row, the request and the demo's line all
      // carry the same split.
      const dealt = props.modalMode === "payment" ? null : dealSplit();

      if (props.modalMode === "payment") {
        splitJson = {
          splits: [
            {
              userId: paymentRecipient,
              percentage: 100,
              amount: Math.abs(amount),
            },
          ],
        };
      } else {
        splitJson = { splits: dealt!.splits };
      }

      const paidByUser = users.find((u) => u.id === userPaid) ?? null;

      const optimisticId = props.editingId ?? crypto.randomUUID();

      const currentAllocation =
        props.modalMode === "payment" && linkToTransaction
          ? computeAllocation(Math.abs(amount), selectedExpenseIds)
          : [];

      const optimisticTpEntries = currentAllocation.map((a) => ({
        id: crypto.randomUUID(),
        pagoId: optimisticId,
        expenseId: a.expenseId,
        amount: a.amount,
        createdAt: new Date(),
      }));

      const optimistic: EnrichedTransaction = {
        id: optimisticId,
        registry_id: registryId,
        description: description || t("modal.default_payment_desc"),
        amount: amount,
        originalAmount: Math.abs(amount),
        type: props.modalMode === "payment" ? "pago" : expenseType,
        exerciseId: null,
        installmentCurrent: expenseType === "parcialidad" ? installmentCurrent : null,
        installmentTotal: expenseType === "parcialidad" ? installmentTotal : null,
        recurringDisabled: false,
        recurringGroupId: optimisticId,
        notes: notes,
        splitJson,
        creatorId: currentUserId,
        userPaid: userPaid,
        relatedTransactionId:
          linkToTransaction && selectedExpenseIds.length === 1 ? selectedExpenseIds[0] : null,
        createdAt: new Date(),
        paidByUser,
      };

      const wasEditing = props.editingId;
      // Pre-optimistic snapshots: if the server rejects the write (4xx or
      // network), the optimistic row must not linger in the list — it would
      // also be persisted to the IndexedDB snapshot and shown as real.
      const prevTransactions = transactions;
      const prevTps = transactionPayments;

      // The optimistic arrays are captured on purpose: every later mutation
      // inside this async handler (demo id swap, server merge) must build on
      // them — the `transactions`/`transactionPayments` props stay frozen at
      // the pre-optimistic render (the signals version re-read `.value` live).
      const optimisticTransactions = wasEditing
        ? transactions.map((t) => (t.id === wasEditing ? optimistic : t))
        : [optimistic, ...transactions];
      let optimisticTps = transactionPayments;
      if (optimisticTpEntries.length > 0) {
        const otherTps = transactionPayments.filter((tp) => tp.pagoId !== optimisticId);
        optimisticTps = [...otherTps, ...optimisticTpEntries];
      } else if (wasEditing) {
        optimisticTps = transactionPayments.filter((tp) => tp.pagoId !== wasEditing);
      }

      props.onTransactionsChange(optimisticTransactions);
      if (optimisticTpEntries.length > 0 || wasEditing) {
        props.onTransactionPaymentsChange(optimisticTps);
      }

      props.onClose();
      props.onRecalculate();

      if (props.isDemo) {
        if (!wasEditing) {
          const serverId = crypto.randomUUID();
          props.onTransactionsChange(
            optimisticTransactions.map((t) =>
              t.id === optimisticId ? { ...optimistic, id: serverId, createdAt: new Date() } : t,
            ),
          );
          if (optimisticTpEntries.length > 0) {
            props.onTransactionPaymentsChange(
              optimisticTps.map((tp) =>
                tp.pagoId === optimisticId ? { ...tp, pagoId: serverId } : tp,
              ),
            );
          }
          props.onRecalculate();
        }
        // No server to report the line here: the deal above is the save.
        if (dealt) props.onRemainderQueueChange(dealt.line);
        return;
      }

      const form = new FormData();
      form.append("description", optimistic.description);
      form.append("amount", optimistic.amount.toString());
      form.append("originalAmount", optimistic.originalAmount.toString());
      form.append("type", optimistic.type);
      form.append("splitJson", JSON.stringify(splitJson));
      // Tells the server which splits are its to deal; a payment has no split to deal.
      if (dealt) form.append("splitMode", splitMode);
      form.append("userPaid", optimistic.userPaid);
      form.append("notes", optimistic.notes);
      form.append("registryId", optimistic.registry_id);
      if (optimistic.type === "parcialidad") {
        form.append("installmentCurrent", installmentCurrent.toString());
        form.append("installmentTotal", installmentTotal.toString());
      }
      if (optimistic.relatedTransactionId) {
        form.append("relatedTransactionId", optimistic.relatedTransactionId);
      }
      if (currentAllocation.length > 0) {
        form.append("transactionPayments", JSON.stringify(currentAllocation));
      } else if (wasEditing && props.modalMode === "payment") {
        form.append("transactionPayments", JSON.stringify([]));
      }

      let res: Response;
      try {
        res = wasEditing
          ? await fetch(`/api/transactions/${wasEditing}`, {
              method: "PUT",
              body: form,
            })
          : await fetch("/api/transactions", {
              method: "POST",
              body: form,
            });
      } catch {
        rollbackSubmit(prevTransactions, prevTps, wasEditing);
        alert(t("common.error_connection"));
        return;
      }

      if (!res.ok) {
        let detail = "";
        try {
          const data = await res.json();
          if (data && typeof data.error === "string") detail = data.error;
        } catch {
          // Non-JSON error body — the generic message is all we can show.
        }
        rollbackSubmit(prevTransactions, prevTps, wasEditing);
        if (res.status === 402) {
          // Free-plan recurring-template cap: the toast (with its /pricing
          // link) replaces the generic alert — it carries the explanation.
          showUpgradeToast(props.locale ?? "es", "billing.templates_full");
          return;
        }
        alert(detail ? `${t("modal.save_error")}\n${detail}` : t("modal.save_error"));
        return;
      }

      const saved = (await res.json()) as EnrichedTransaction & {
        lastModified?: string | null;
        remainderQueue?: string[];
      };
      const { lastModified: serverStamp, remainderQueue, ...savedTx } = saved;
      if (serverStamp !== undefined) {
        props.onServerStamp?.(serverStamp ?? null);
      }
      if (remainderQueue) {
        props.onRemainderQueueChange(remainderQueue);
      }
      const serverPaidBy = users.find((u) => u.id === savedTx.userPaid) ?? null;
      const serverCreatedAt =
        typeof savedTx.createdAt === "string" ? new Date(savedTx.createdAt) : savedTx.createdAt;
      props.onTransactionsChange(
        optimisticTransactions.map((t) =>
          t.id === (wasEditing ?? optimisticId)
            ? {
                ...savedTx,
                paidByUser: serverPaidBy,
                createdAt: serverCreatedAt,
              }
            : t,
        ),
      );
      if (!wasEditing) {
        const serverId = savedTx.id as string;
        if (serverId && serverId !== optimisticId) {
          props.onTransactionPaymentsChange(
            optimisticTps.map((tp) =>
              tp.pagoId === optimisticId ? { ...tp, pagoId: serverId } : tp,
            ),
          );
        }
        saveLastSplitConfig();
      }
      props.onRecalculate();
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Undo the optimistic write after a rejected submit and reopen the modal
   * with the user's input still in the form (state was never cleared).
   */
  function rollbackSubmit(
    prevTransactions: EnrichedTransaction[],
    prevTps: TransactionPayment[],
    wasEditing: string | null,
  ) {
    props.onTransactionsChange(prevTransactions);
    props.onTransactionPaymentsChange(prevTps);
    props.onRecalculate();
    reopenWithoutReset.current = true;
    props.onReopen(wasEditing);
  }

  async function handleDelete() {
    if (!props.editingId) return;
    if (!confirm(t("modal.delete_confirm"))) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      const id = props.editingId;
      const index = transactions.findIndex((t) => t.id === id);
      if (index === -1) return;
      const removed = transactions[index];

      props.onTransactionsChange(transactions.filter((t) => t.id !== id));
      props.onClose();
      props.onRecalculate();

      if (props.isDemo) return;

      const restore = () => {
        const restored = [...transactions];
        restored.splice(Math.min(index, restored.length), 0, removed);
        props.onTransactionsChange(restored);
        props.onRecalculate();
      };
      try {
        const res = await fetch(`/api/transactions/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          restore();
          alert(t("modal.delete_error"));
          return;
        }
        try {
          const data = (await res.json()) as { lastModified?: string | null };
          if (data?.lastModified !== undefined) {
            props.onServerStamp?.(data.lastModified ?? null);
          }
        } catch {
          // No JSON body (e.g. a 204) — stamp unknown; the next sync
          // refetches and relabels.
        }
      } catch {
        restore();
        alert(t("common.error_connection"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const eligibleTransactions = useMemo(() => {
    const uid = userPaid;
    const debtMap = new Map<string, { tx: EnrichedTransaction; debt: number }>();

    // A payment goes to one person, so only what that person paid — and the
    // payer still owes — can settle it.
    for (const tx of transactions) {
      if (tx.type === "pago" || tx.type === "ajuste") continue;
      if (tx.userPaid === uid) continue;
      if (tx.userPaid !== paymentRecipient) continue;

      const userSplit = tx.splitJson.splits.find((s) => s.userId === uid);
      if (!userSplit) continue;

      const divisor = tx.type === "parcialidad" && tx.installmentTotal ? tx.installmentTotal : 1;
      const debt = userSplit.amount / divisor;

      if (debt > 0.005) {
        debtMap.set(tx.id, { tx, debt });
      }
    }

    for (const tx of transactions) {
      if (tx.type !== "pago") continue;
      if (tx.userPaid !== uid) continue;
      if (tx.id === (props.editingId ?? undefined)) continue;

      const pagoTps = transactionPayments.filter((tp) => tp.pagoId === tx.id);
      if (pagoTps.length > 0) {
        for (const tp of pagoTps) {
          const entry = debtMap.get(tp.expenseId);
          if (entry) {
            entry.debt -= tp.amount;
          }
        }
      } else if (tx.relatedTransactionId) {
        const entry = debtMap.get(tx.relatedTransactionId);
        if (entry) {
          entry.debt -= tx.originalAmount;
        }
      }
    }

    const result: EligibleTransaction[] = [];
    for (const [id, { tx, debt }] of debtMap) {
      if (debt > 0.005) {
        const paidByName = tx.paidByUser?.name ?? t("modal.unknown_payer");
        result.push({
          id,
          description: tx.description,
          userPaid: tx.userPaid,
          paidByUser: paidByName,
          originalDebt: (() => {
            const us = tx.splitJson.splits.find((s) => s.userId === uid);
            if (!us) return 0;
            const d = tx.type === "parcialidad" && tx.installmentTotal ? tx.installmentTotal : 1;
            return us.amount / d;
          })(),
          remainingDebt: Math.round(debt * 100) / 100,
          createdAt: tx.createdAt,
        });
      }
    }

    result.sort((a, b) => a.remainingDebt - b.remainingDebt);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    transactions,
    transactionPayments,
    props.editingId,
    userPaid,
    paymentRecipient,
    props.locale,
  ]);

  // A selection can outlive its eligibility — the recipient changed after an
  // expense was picked, or an edited payment points at one its recipient never
  // paid. Drop whatever the list no longer offers so nothing unlisted is
  // ever submitted.
  useEffect(() => {
    setSelectedExpenseIds((prev) => {
      const kept = prev.filter((id) => eligibleTransactions.some((e) => e.id === id));
      return kept.length === prev.length ? prev : kept;
    });
    setSelectedRelatedTxId((prev) =>
      prev !== null && eligibleTransactions.some((e) => e.id === prev) ? prev : null,
    );
  }, [eligibleTransactions]);

  const hasEligibleTransactions = eligibleTransactions.length > 0;
  const paymentRecipientName =
    users.find((u) => u.id === paymentRecipient)?.name ?? t("modal.unknown_payer");

  const filteredEligible = useMemo(() => {
    const list = eligibleTransactions;
    if (!relatedTxSearch.trim()) return list;
    const q = relatedTxSearch.trim().toLowerCase();
    return list.filter(
      (e) => e.description.toLowerCase().includes(q) || e.paidByUser.toLowerCase().includes(q),
    );
  }, [eligibleTransactions, relatedTxSearch]);

  const selectedRelatedTx = useMemo(() => {
    if (!selectedRelatedTxId) return null;
    return eligibleTransactions.find((e) => e.id === selectedRelatedTxId) ?? null;
  }, [eligibleTransactions, selectedRelatedTxId]);

  const splits = useMemo(
    () => getSplits(),
    [amount, users, splitMode, line, percentages, fixedAmounts, savedSplit],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const isPago = props.modalMode === "payment";

  const debtToRecipient = isPago
    ? (() => {
        if (userPaid === currentUserId) {
          const entry = props.balanceEntries.find((b) => b.userId === paymentRecipient);
          return entry && entry.amount < -0.005 ? Math.abs(entry.amount) : 0;
        }
        if (paymentRecipient === currentUserId) {
          const entry = props.balanceEntries.find((b) => b.userId === userPaid);
          return entry && entry.amount > 0.005 ? entry.amount : 0;
        }
        return 0;
      })()
    : 0;

  const modalTitle = isPago
    ? isEditing
      ? t("modal.edit_payment")
      : t("modal.new_payment")
    : isEditing
      ? t("modal.edit_expense")
      : t("modal.new_expense");
  const modalSubtitle = isPago
    ? isEditing
      ? t("modal.edit_payment_subtitle")
      : t("modal.new_payment_subtitle")
    : isEditing
      ? t("modal.edit_expense_subtitle")
      : t("modal.new_expense_subtitle");

  const totalSplitAmount = splits.reduce((s, sp) => s + sp.amount, 0);
  const expenseTotal = Math.abs(amount);
  // Porcentaje follows the typed percentages, so their sum is the truth. Auto
  // and Monto Fijo follow the amounts: the total is the share of the expense
  // they cover (three rows of 33.33% do add up to the whole expense).
  const totalPct =
    splitMode === "percentage"
      ? totalPercentage()
      : expenseTotal > 0
        ? (totalSplitAmount / expenseTotal) * 100
        : 0;

  // Only Porcentaje and Monto Fijo can leave an expense short or over; Auto
  // always accounts for the whole amount. An empty amount keeps its existing
  // handling.
  const splitCheck =
    !isPago && splitMode !== "auto" && expenseTotal > 0
      ? checkSplitSum(
          expenseTotal,
          splits.map((s) => s.amount),
        )
      : null;
  const splitBlocked = splitCheck !== null && !splitCheck.ok;
  const splitTotalOk = splitCheck === null || splitCheck.ok;
  /** Live verdict on the split; rendered inside the TOTAL row of each layout. */
  const splitFeedback = (id: string) =>
    splitCheck && (
      <span id={id} role="status" className="font-medium not-italic">
        <span className={splitCheck.ok ? "text-emerald-400" : "text-red-400"}>
          {splitCheck.ok
            ? t("modal.split_complete")
            : splitCheck.difference > 0
              ? t("modal.split_remaining", { amount: money(Math.abs(splitCheck.difference)) })
              : t("modal.split_over", { amount: money(Math.abs(splitCheck.difference)) })}
        </span>
        {!splitCheck.ok && <span className="sr-only"> {t("modal.split_blocked")}</span>}
      </span>
    );

  if (!props.isOpen) return null;

  /** A split-mode segment: full width on phones, natural width beside the heading. */
  const splitModeClass = (mode: SplitMode) =>
    `px-1 sm:px-3 py-1.5 text-xs font-semibold whitespace-nowrap rounded-custom transition-colors ${
      splitMode === mode
        ? "bg-primary text-white shadow-sm"
        : "text-zinc-400 hover:text-white hover:bg-white/5"
    }`;

  return (
    <Modal
      onClose={props.onClose}
      closeLabel={t("common.close")}
      title={modalTitle}
      subtitle={modalSubtitle}
      widthClass="max-w-2xl"
      closeOnBackdrop={false}
      footer={
        <>
          <div>
            {isEditing && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {t("common.delete")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={props.onClose}
              className="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={
                submitting ||
                splitBlocked ||
                (linkToTransaction &&
                  selectedRelatedTxId !== null &&
                  (() => {
                    const stx = selectedRelatedTx;
                    return stx !== null && Math.abs(amount) > stx.remainingDebt + 0.005;
                  })())
              }
              title={splitBlocked ? t("modal.split_blocked") : undefined}
              aria-describedby={
                splitBlocked ? "split-feedback-desktop split-feedback-mobile" : undefined
              }
              onClick={handleSubmit}
              className={`px-8 py-2 text-sm font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50 ${
                isPago
                  ? "bg-indigo-500 hover:bg-indigo-400 text-white"
                  : "bg-primary hover:bg-primary-light text-white"
              }`}
            >
              {submitting ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto max-h-[75vh]"
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-300" htmlFor="description">
            {t("modal.description")}
          </label>
          <input
            className="block w-full px-4 py-2.5 bg-background border border-border-field rounded-custom text-white focus:ring-primary-text focus:border-primary-text"
            id="description"
            type="text"
            placeholder={
              isPago
                ? t("modal.description_payment_placeholder")
                : t("modal.description_expense_placeholder")
            }
            value={description}
            onInput={(e) => setDescription(e.currentTarget.value)}
            {...(isPago ? {} : { required: true })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-300" htmlFor="total-amount">
              {isPago
                ? t("modal.amount_payment")
                : expenseType === "parcialidad" && installmentInputMode === "installment"
                  ? t("modal.amount_installment")
                  : t("modal.amount_total")}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">$</span>
              <input
                className="block w-full pl-8 pr-4 py-2.5 bg-background border border-border-field rounded-custom text-white text-lg font-semibold focus:ring-primary-text focus:border-primary-text"
                id="total-amount"
                type="text"
                inputMode="decimal"
                value={
                  expenseType === "parcialidad" && installmentInputMode === "installment"
                    ? installmentAmountDisplay || installmentAmount || ""
                    : amountDisplay || amount || ""
                }
                onInput={(e) => {
                  if (expenseType === "parcialidad" && installmentInputMode === "installment") {
                    const sanitized = handleInstallmentAmountChange(e.currentTarget.value);
                    e.currentTarget.value = sanitized;
                  } else {
                    const sanitized = handleAmountChange(e.currentTarget.value);
                    e.currentTarget.value = sanitized;
                  }
                }}
                onBlur={(e) => {
                  const val = parseFloat(e.currentTarget.value) || 0;
                  e.currentTarget.value = val === 0 ? "" : val.toString();
                  if (expenseType === "parcialidad" && installmentInputMode === "installment") {
                    setInstallmentAmountDisplay(val === 0 ? "" : val.toString());
                  } else {
                    setAmountDisplay(val === 0 ? "" : val.toString());
                  }
                }}
                required
              />
            </div>
            {expenseType === "parcialidad" &&
              installmentInputMode === "installment" &&
              installmentTotal > 0 && (
                <p className="text-xs text-zinc-400 mt-1">
                  Total: {money(Math.abs(amount))} (
                  {t("modal.installment_count", {
                    n: installmentTotal,
                  })}
                  )
                </p>
              )}
            {isPago && debtToRecipient > 0 && (
              <button
                type="button"
                data-tour="pay-debt"
                onClick={() => {
                  // The field itself stays a plain number, like a typed one.
                  setAmount(debtToRecipient);
                  setAmountDisplay(debtToRecipient.toString());
                }}
                className="flex items-center gap-2 mt-1.5 px-3 py-1.5 rounded-custom border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer group"
              >
                <svg
                  className="h-3.5 w-3.5 text-emerald-400 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span className="text-xs font-medium text-emerald-300">
                  {t("modal.pay_debt", {
                    amount: money(debtToRecipient),
                  })}
                </span>
              </button>
            )}
          </div>
          {!isPago && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">{t("modal.type")}</label>
              <div
                className="flex gap-1 p-1 bg-background border border-border-field rounded-custom"
                data-tour="expense-type"
              >
                {(["unico", "parcialidad", "recurrente"] as TransactionType[]).map((typeVal) => (
                  <button
                    key={typeVal}
                    type="button"
                    onClick={() => setExpenseType(typeVal)}
                    className={`flex-1 py-2 text-sm font-medium rounded-custom transition-colors ${
                      expenseType === typeVal
                        ? "bg-primary text-white shadow-sm"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {typeVal === "unico"
                      ? t("type.unico")
                      : typeVal === "parcialidad"
                        ? t("type.parcialidad")
                        : t("type.recurrente")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {expenseType === "parcialidad" && (
          <div className="space-y-3 sm:space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setInstallmentInputMode("total");
                }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-custom transition-colors border ${
                  installmentInputMode === "total"
                    ? "bg-primary/20 border-primary text-white"
                    : "bg-background border-white/20 text-zinc-400 hover:text-white"
                }`}
              >
                {t("modal.installment_mode_total")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInstallmentInputMode("installment");
                  if (installmentAmount === 0 && amount > 0) {
                    setInstallmentAmount(Math.round((amount / installmentTotal) * 100) / 100);
                  }
                }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-custom transition-colors border ${
                  installmentInputMode === "installment"
                    ? "bg-primary/20 border-primary text-white"
                    : "bg-background border-white/20 text-zinc-400 hover:text-white"
                }`}
              >
                {t("modal.installment_mode_per")}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-300">
                  {t("modal.installment_current")}
                </label>
                <div className="flex items-center gap-3">
                  <select
                    className="block w-full px-4 py-2 bg-background border border-border-field rounded-custom text-white focus:ring-primary-text focus:border-primary-text"
                    value={installmentCurrent}
                    onChange={(e) => setInstallmentCurrent(parseInt(e.currentTarget.value))}
                  >
                    {Array.from({ length: installmentTotal }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                  <span className="text-zinc-400">{t("modal.installment_of")}</span>
                  <input
                    className="block w-20 px-4 py-2 bg-background border border-border-field rounded-custom text-white focus:ring-primary-text focus:border-primary-text"
                    type="text"
                    inputMode="numeric"
                    value={installmentTotalDisplay}
                    onInput={(e) => {
                      const sanitized = sanitizeInteger(e.currentTarget.value);
                      e.currentTarget.value = sanitized;
                      setInstallmentTotalDisplay(sanitized);
                      const newTotal = parseInt(sanitized) || 0;
                      if (newTotal > 0) {
                        setInstallmentTotal(newTotal);
                      }
                      if (installmentInputMode === "installment" && newTotal > 0) {
                        setAmount(Math.round(installmentAmount * newTotal * 100) / 100);
                      }
                    }}
                    onBlur={(e) => {
                      const val = parseInt(e.currentTarget.value) || 0;
                      const clamped = val < 1 ? 1 : val;
                      e.currentTarget.value = clamped.toString();
                      setInstallmentTotalDisplay(clamped.toString());
                      setInstallmentTotal(clamped);
                      if (installmentInputMode === "installment") {
                        setAmount(Math.round(installmentAmount * clamped * 100) / 100);
                      }
                    }}
                  />
                  <span className="text-zinc-400">{t("modal.installment_months")}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isPago && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-300" htmlFor="payer-select">
              {t("modal.payer")}
            </label>
            <select
              id="payer-select"
              className="block w-full px-4 py-2.5 bg-background border border-border-field rounded-custom text-white focus:ring-primary-text focus:border-primary-text"
              value={userPaid}
              onChange={(e) => setUserPaid(e.currentTarget.value)}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                  {user.id === currentUserId ? ` ${t("common.you_label")}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {isPago ? (
          <>
            <section className="space-y-3 sm:space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
                {t("modal.transfer_section")}
              </h3>
              <div className="border border-white/10 rounded-custom overflow-hidden">
                <table className="hidden md:table w-full text-left border-collapse">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-4 py-3 text-xs font-semibold text-zinc-400">
                        {t("modal.user_header")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-zinc-400 w-24 text-center">
                        {t("modal.paid_header")}
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-zinc-400 w-24 text-center">
                        {t("modal.received_header")}
                      </th>
                      {users.length > 2 && (
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-400 text-right">
                          {t("modal.balance_header")}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-custom">
                    {users.map((user) => {
                      const userInitials = initials(user.name);
                      return (
                        <tr key={user.id}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={{ backgroundColor: `${user.color}30` }}
                              >
                                {userInitials}
                              </div>
                              <span className="text-sm font-medium text-white">
                                {user.name}
                                {user.id === currentUserId && (
                                  <span className="text-zinc-400 ml-1">
                                    {t("common.you_label")}
                                  </span>
                                )}
                                {props.entityIds.has(user.id) && (
                                  <span className="text-xs ml-1 px-1.5 py-0.5 rounded bg-white/10 text-zinc-400">
                                    {t("common.tercero_badge")}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {/* The padded label turns the 20px radio into a 36px target. */}
                            <label className="inline-flex p-2 -m-2 cursor-pointer">
                              <input
                                type="radio"
                                name="pagoPaid"
                                value={user.id}
                                checked={userPaid === user.id}
                                onChange={() => {
                                  setUserPaid(user.id);
                                  if (paymentRecipient === user.id) {
                                    setPaymentRecipient(
                                      users.find((u) => u.id !== user.id)?.id ?? "",
                                    );
                                  }
                                }}
                                aria-label={`${t("modal.paid_header")}: ${user.name}`}
                                className="w-5 h-5 accent-primary cursor-pointer"
                              />
                            </label>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <label className="inline-flex p-2 -m-2 cursor-pointer">
                              <input
                                type="radio"
                                name="pagoRecipient"
                                value={user.id}
                                checked={paymentRecipient === user.id}
                                onChange={() => {
                                  setPaymentRecipient(user.id);
                                  if (userPaid === user.id) {
                                    setUserPaid(
                                      users.find((u) => u.id !== user.id)?.id ?? currentUserId,
                                    );
                                  }
                                }}
                                aria-label={`${t("modal.received_header")}: ${user.name}`}
                                className="w-5 h-5 accent-indigo-400 cursor-pointer"
                              />
                            </label>
                          </td>
                          {users.length > 2 && (
                            <td className="px-4 py-3 text-right">
                              {user.id !== currentUserId &&
                                (() => {
                                  const bd = props.balanceEntries.find((b) => b.userId === user.id);
                                  if (!bd || Math.abs(bd.amount) < 0.01) {
                                    return null;
                                  }
                                  return bd.amount > 0 ? (
                                    <span className="text-xs font-semibold text-emerald-400">
                                      {t("modal.owes_you", {
                                        amount: money(bd.amount),
                                      })}
                                    </span>
                                  ) : (
                                    <span className="text-xs font-semibold text-red-400">
                                      {t("modal.you_owe_them", {
                                        amount: money(Math.abs(bd.amount)),
                                      })}
                                    </span>
                                  );
                                })()}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="md:hidden divide-y divide-border-custom">
                  {users.map((user) => {
                    const userInitials = initials(user.name);
                    const bd =
                      users.length > 2 && user.id !== currentUserId
                        ? props.balanceEntries.find((b) => b.userId === user.id)
                        : null;
                    return (
                      <div key={user.id} className="flex items-center gap-3 px-3 py-3">
                        {/* Each column is its own label, so the caption is part of the target. */}
                        <label className="flex flex-col items-center gap-1 p-2 -m-2 cursor-pointer">
                          <span className="text-[9px] text-zinc-400 uppercase">
                            {t("modal.paid_header")}
                          </span>
                          <input
                            type="radio"
                            name="pagoPaidMobile"
                            value={user.id}
                            checked={userPaid === user.id}
                            onChange={() => {
                              setUserPaid(user.id);
                              if (paymentRecipient === user.id) {
                                setPaymentRecipient(users.find((u) => u.id !== user.id)?.id ?? "");
                              }
                            }}
                            aria-label={`${t("modal.paid_header")}: ${user.name}`}
                            className="w-5 h-5 accent-primary cursor-pointer"
                          />
                        </label>
                        <label className="flex flex-col items-center gap-1 p-2 -m-2 cursor-pointer">
                          <span className="text-[9px] text-zinc-400 uppercase">
                            {t("modal.received_header")}
                          </span>
                          <input
                            type="radio"
                            name="pagoRecipientMobile"
                            value={user.id}
                            checked={paymentRecipient === user.id}
                            onChange={() => {
                              setPaymentRecipient(user.id);
                              if (userPaid === user.id) {
                                setUserPaid(
                                  users.find((u) => u.id !== user.id)?.id ?? currentUserId,
                                );
                              }
                            }}
                            aria-label={`${t("modal.received_header")}: ${user.name}`}
                            className="w-5 h-5 accent-indigo-400 cursor-pointer"
                          />
                        </label>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                              style={{ backgroundColor: `${user.color}30` }}
                            >
                              {userInitials}
                            </div>
                            <span className="text-sm font-medium text-white truncate">
                              {user.name}
                              {user.id === currentUserId && (
                                <span className="text-zinc-400 ml-1">{t("common.you_label")}</span>
                              )}
                              {props.entityIds.has(user.id) && (
                                <span className="text-xs ml-1 px-1 py-0.5 rounded bg-white/10 text-zinc-400">
                                  {t("common.tercero_badge")}
                                </span>
                              )}
                            </span>
                          </div>
                          {bd && Math.abs(bd.amount) >= 0.01 && (
                            <span
                              className={`text-xs font-semibold ${
                                bd.amount > 0 ? "text-emerald-400" : "text-red-400"
                              } ml-8`}
                            >
                              {bd.amount > 0
                                ? t("modal.owes_you", {
                                    amount: money(bd.amount),
                                  })
                                : t("modal.you_owe_them", {
                                    amount: money(Math.abs(bd.amount)),
                                  })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <label className="flex items-center gap-3 -my-1.5 py-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={linkToTransaction}
                  disabled={!hasEligibleTransactions || amount === 0}
                  onChange={() => {
                    setLinkToTransaction(!linkToTransaction);
                    if (!linkToTransaction) {
                      setSelectedRelatedTxId(null);
                      setSelectedExpenseIds([]);
                    }
                  }}
                  className="w-5 h-5 shrink-0 accent-primary cursor-pointer"
                />
                <span className="text-sm font-medium text-zinc-300">
                  {t("modal.link_expenses")}
                </span>
                {!hasEligibleTransactions && (
                  <span className="relative group">
                    <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold rounded-full bg-white/10 text-zinc-400 cursor-help">
                      ?
                    </span>
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 w-64 bg-surface border border-white/10 text-white text-xs font-normal no-underline rounded-custom px-3 py-2 shadow-xl z-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      {t("modal.link_expenses_tooltip")}
                    </span>
                  </span>
                )}
              </label>

              {linkToTransaction && hasEligibleTransactions && (
                <div className="space-y-2">
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-400">
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                    </span>
                    <input
                      type="text"
                      placeholder={t("modal.search_expense")}
                      value={relatedTxSearch}
                      onInput={(e) => setRelatedTxSearch(e.currentTarget.value)}
                      className="w-full bg-background border border-border-field rounded-custom pl-9 pr-8 text-white text-sm placeholder-zinc-400 focus:ring-primary-text focus:border-primary-text py-2"
                    />
                    {relatedTxSearch && (
                      <button
                        type="button"
                        onClick={() => setRelatedTxSearch("")}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-white"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M6 18L18 6M6 6l12 12"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                          />
                        </svg>
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-zinc-400">
                    {t("modal.link_expenses_scope", { name: paymentRecipientName })}
                  </p>

                  <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1.5 border border-white/5 rounded-custom p-2 bg-background">
                    {filteredEligible.length === 0 ? (
                      <p className="text-xs text-zinc-400 text-center py-4">
                        {t("modal.no_expenses_found")}
                      </p>
                    ) : (
                      filteredEligible.map((etx) => {
                        const isSelected = selectedExpenseIds.includes(etx.id);
                        const paidByName = etx.paidByUser;
                        const maxAmount = etx.remainingDebt;
                        return (
                          <button
                            key={etx.id}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setSelectedExpenseIds(
                                  selectedExpenseIds.filter((id) => id !== etx.id),
                                );
                              } else {
                                setSelectedExpenseIds([...selectedExpenseIds, etx.id]);
                                setPaymentRecipient(etx.userPaid);
                              }
                              enforceSelectionConstraint();
                            }}
                            className={`w-full text-left p-3 rounded-custom transition-all ${
                              isSelected
                                ? "bg-emerald-900/30 border border-emerald-700/40"
                                : "bg-white/5 border border-white/5 hover:bg-white/5"
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p
                                  className={`text-sm font-medium truncate ${
                                    isSelected ? "text-emerald-300" : "text-white"
                                  }`}
                                >
                                  {etx.description}
                                </p>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                  {t("modal.paid_by_name", {
                                    name: paidByName,
                                  })}{" "}
                                  &bull;{" "}
                                  {formatDate(etx.createdAt, props.locale ?? "es", {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-red-400">
                                  -${formatMoney(maxAmount)}
                                </p>
                                {Math.abs(etx.remainingDebt - etx.originalDebt) > 0.01 && (
                                  <p className="text-[10px] text-zinc-400">
                                    {t("tx.of_total", {
                                      total: formatMoney(etx.originalDebt),
                                    })}
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {selectedExpenseIds.length > 0 && (
                    <div className="space-y-2">
                      {(() => {
                        const alloc = computeAllocation(Math.abs(amount), selectedExpenseIds);
                        const totalAllocated = alloc.reduce((s, a) => s + a.amount, 0);
                        const remainder = Math.abs(amount) - totalAllocated;
                        return (
                          <div className="border border-white/10 rounded-custom p-3 bg-white/5 space-y-2">
                            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                              {t("modal.allocation_section")}
                            </p>
                            {alloc.map((a, idx) => {
                              const exp = eligibleTransactions.find((e) => e.id === a.expenseId);
                              const coverage = exp ? Math.min(1, a.amount / exp.remainingDebt) : 1;
                              const isFull = coverage >= 0.99;
                              const barWidth = Math.round(coverage * 100);
                              const barColor = isFull
                                ? "bg-emerald-500"
                                : coverage >= 0.5
                                  ? "bg-amber-500"
                                  : "bg-red-400";
                              return (
                                <div
                                  key={a.expenseId}
                                  className={`flex flex-col gap-1${
                                    idx > 0 ? " pt-2 border-t border-white/5" : ""
                                  }`}
                                >
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-300 truncate">
                                      {exp?.description ?? t("modal.allocation_expense")}
                                    </span>
                                    <span className="text-white font-semibold ml-2">
                                      ${formatMoney(a.amount)}
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full ${barColor} rounded-full transition-all`}
                                      style={{ width: `${barWidth}%` }}
                                    />
                                  </div>
                                  <div className="flex justify-between items-center text-[10px] text-zinc-400">
                                    <span>
                                      {isFull
                                        ? t("modal.allocation_fully_covered")
                                        : t("modal.allocation_partial", {
                                            covered: money(a.amount),
                                            total: money(exp!.remainingDebt),
                                          })}
                                    </span>
                                    {!isFull && (
                                      <span
                                        className={`${
                                          coverage >= 0.5 ? "text-amber-400" : "text-red-400"
                                        } font-medium`}
                                      >
                                        {barWidth}%
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {remainder > 0.005 && (
                              <div className="flex justify-between items-center text-xs border-t border-white/5 pt-1.5">
                                <span className="text-zinc-400">
                                  {t("modal.allocation_unassigned")}
                                </span>
                                <span className="text-amber-400 font-semibold">
                                  ${formatMoney(remainder)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="space-y-3 sm:space-y-4">
            {/* Phones: heading on its own line above a full-width segmented
                control, so nothing is squeezed or wrapped. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
                {t("modal.split_section")}
              </h3>
              <div className="grid grid-cols-3 gap-1 sm:flex sm:gap-2" data-tour="split-mode">
                <button type="button" onClick={setAutoSplit} className={splitModeClass("auto")}>
                  {t("modal.split_auto")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // An edit keeps its own shares when switching representation.
                    if (isEditingExpense) {
                      setPercentages(percentagesFor(getSplits()));
                    } else if (defaultSplit) {
                      setPercentages(buildDefaultPercentages());
                    }
                    setSplitMode("percentage");
                  }}
                  className={splitModeClass("percentage")}
                >
                  {t("modal.split_percentage")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isEditingExpense) setFixedAmounts(fixedAmountsFrom(getSplits()));
                    setSplitMode("fixed");
                  }}
                  className={splitModeClass("fixed")}
                >
                  {t("modal.split_fixed")}
                </button>
              </div>
            </div>

            <div className="border border-white/10 rounded-custom overflow-hidden">
              <table className="hidden md:table w-full text-left border-collapse">
                <thead className="bg-white/5">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-400">
                      {t("modal.user_header")}
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-400 w-32 text-right">
                      %
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-400 w-40 text-right">
                      {t("modal.amount_header")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-custom">
                  {users.map((user) => {
                    const split = splits.find((s) => s.userId === user.id);
                    const userInitials = initials(user.name);
                    return (
                      <tr key={user.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={{ backgroundColor: `${user.color}30` }}
                            >
                              {userInitials}
                            </div>
                            <span className="text-sm font-medium text-white">
                              {user.name}
                              {user.id === currentUserId && (
                                <span className="text-zinc-400 ml-1">{t("common.you_label")}</span>
                              )}
                              {props.entityIds.has(user.id) && (
                                <span className="text-xs ml-1 px-1.5 py-0.5 rounded bg-white/10 text-zinc-400">
                                  {t("common.tercero_badge")}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            {splitMode === "percentage" ? (
                              <input
                                className="w-20 px-2 py-1 bg-background border border-border-field rounded text-right text-sm font-medium text-white focus:ring-primary-text focus:border-primary-text"
                                type="text"
                                inputMode="decimal"
                                aria-label={`% ${user.name}`}
                                value={percentages[user.id] ?? 0}
                                onInput={(e) => {
                                  const sanitized = sanitizeDecimal(e.currentTarget.value);
                                  e.currentTarget.value = sanitized;
                                  updatePercentage(user.id, sanitized);
                                }}
                              />
                            ) : (
                              <span className="text-sm text-zinc-400">
                                {split?.percentage.toFixed(2) ?? "0.00"}
                              </span>
                            )}
                            <span className="ml-1 text-zinc-400">%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            {splitMode === "fixed" ? (
                              <>
                                <span className="mr-1 text-zinc-400">$</span>
                                <input
                                  className="w-28 px-2 py-1 bg-background border border-border-field rounded text-right text-sm font-medium text-white focus:ring-primary-text focus:border-primary-text"
                                  type="text"
                                  inputMode="decimal"
                                  aria-label={`${t("modal.amount_header")} ${user.name}`}
                                  value={fixedAmounts[user.id] ?? 0}
                                  onInput={(e) => {
                                    const sanitized = sanitizeDecimal(e.currentTarget.value);
                                    e.currentTarget.value = sanitized;
                                    updateFixedAmount(user.id, sanitized);
                                  }}
                                />
                              </>
                            ) : (
                              <span className="text-sm text-white">
                                {money(split?.amount ?? 0)}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-white/5">
                  <tr>
                    <td className="px-4 py-2 text-xs font-bold text-zinc-400 italic">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>{t("modal.total_header")}</span>
                        {splitFeedback("split-feedback-desktop")}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-bold ${
                        splitTotalOk ? "text-white" : "text-red-400"
                      }`}
                    >
                      {totalPct.toFixed(2)}%
                    </td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-bold ${
                        splitTotalOk ? "text-white" : "text-red-400"
                      }`}
                    >
                      {money(totalSplitAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Phones: one line per member. What is set on top (the amount, or
                  the input of the active mode), what it amounts to underneath. */}
              <div className="md:hidden divide-y divide-border-custom">
                {users.map((user) => {
                  const split = splits.find((s) => s.userId === user.id);
                  const splitAmount = split?.amount ?? 0;
                  const splitPercentage = `${split?.percentage.toFixed(2) ?? "0.00"}%`;
                  return (
                    <div key={user.id} className="flex items-center gap-2 px-3 py-2">
                      <div
                        className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ backgroundColor: `${user.color}30` }}
                      >
                        {initials(user.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span
                          className="block truncate text-sm font-medium text-white"
                          title={user.name}
                        >
                          {user.name}
                          {user.id === currentUserId && (
                            <span className="text-zinc-400 ml-1">{t("common.you_label")}</span>
                          )}
                          {props.entityIds.has(user.id) && (
                            <span className="text-xs ml-1 px-1 py-0.5 rounded bg-white/10 text-zinc-400">
                              {t("common.tercero_badge")}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1 text-sm">
                          {splitMode === "fixed" && <span className="text-zinc-400">$</span>}
                          {splitMode === "auto" ? (
                            <span className="font-medium text-white">{money(splitAmount)}</span>
                          ) : (
                            <input
                              className={`${splitMode === "fixed" ? "w-20" : "w-16"} px-2 py-1 bg-background border border-border-field rounded text-right text-sm font-medium text-white focus:ring-primary-text focus:border-primary-text`}
                              type="text"
                              inputMode="decimal"
                              aria-label={`${splitMode === "fixed" ? t("modal.amount_header") : "%"} ${user.name}`}
                              value={
                                splitMode === "fixed"
                                  ? (fixedAmounts[user.id] ?? 0)
                                  : (percentages[user.id] ?? 0)
                              }
                              onInput={(e) => {
                                const sanitized = sanitizeDecimal(e.currentTarget.value);
                                e.currentTarget.value = sanitized;
                                if (splitMode === "fixed") updateFixedAmount(user.id, sanitized);
                                else updatePercentage(user.id, sanitized);
                              }}
                            />
                          )}
                          {splitMode === "percentage" && <span className="text-zinc-400">%</span>}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {splitMode === "percentage" ? money(splitAmount) : splitPercentage}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="px-3 py-2 bg-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-400 italic">
                      {t("modal.total_header")}
                    </span>
                    <div className="flex items-center gap-4">
                      <span
                        className={`text-xs font-bold ${
                          splitTotalOk ? "text-white" : "text-red-400"
                        }`}
                      >
                        {totalPct.toFixed(2)}%
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          splitTotalOk ? "text-white" : "text-red-400"
                        }`}
                      >
                        {money(totalSplitAmount)}
                      </span>
                    </div>
                  </div>
                  {splitCheck && (
                    <div className="mt-0.5 text-right text-xs">
                      {splitFeedback("split-feedback-mobile")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Optional, so it stays out of the way until asked for (or until the
            transaction already has a note). */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setNotesOpen(!notesOpen)}
            aria-expanded={notesOpen}
            aria-controls="notes"
            className="-my-1.5 flex items-center gap-1.5 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${notesOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
            {notesOpen || notes ? t("modal.notes") : t("modal.add_note")}
          </button>
          {notesOpen && (
            <textarea
              className="block w-full px-4 py-2.5 bg-background border border-border-field rounded-custom text-white focus:ring-primary-text focus:border-primary-text resize-none"
              id="notes"
              aria-label={t("modal.notes")}
              rows={2}
              placeholder={t("modal.notes_placeholder")}
              value={notes}
              onInput={(e) => setNotes(e.currentTarget.value)}
            />
          )}
        </div>
      </form>
    </Modal>
  );
}
