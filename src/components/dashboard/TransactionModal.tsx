/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  SplitEntry,
  TransactionPayment,
  TransactionSplit,
} from "../../lib/types";
import type { EnrichedTransaction } from "../../lib/types";
import {
  buildEqualSplit,
  buildFixedSplit,
  buildPercentageSplit,
  computeDefaultPercentages,
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
  onRecalculate: () => void;
  /**
   * Receives the registry's fresh `last_modified` returned by mutation
   * endpoints, so the caller can label its cached snapshot with the version
   * its own write produced (a stale label forces a redundant refetch on the
   * next sync). Called with null when the server reports no stamp.
   */
  onServerStamp?: (stamp: string | null) => void;
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

type SplitMode = "auto" | "percentage" | "fixed";
type TransactionType = "unico" | "parcialidad" | "recurrente" | "pago" | "ajuste";

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
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState(0);
  const [amountDisplay, setAmountDisplay] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [expenseType, setExpenseType] = useState<TransactionType>("unico");
  const [installmentCurrent, setInstallmentCurrent] = useState(1);
  const [installmentTotal, setInstallmentTotal] = useState(12);
  const [installmentTotalDisplay, setInstallmentTotalDisplay] = useState("12");
  const [installmentInputMode, setInstallmentInputMode] = useState<"total" | "installment">("total");
  const [installmentAmount, setInstallmentAmount] = useState(0);
  const [installmentAmountDisplay, setInstallmentAmountDisplay] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("auto");
  const [splitSeed] = useState<string>(() => crypto.randomUUID());
  const [userPaid, setUserPaid] = useState(currentUserId);
  const [paymentRecipient, setPaymentRecipient] = useState<string>(
    () => users.find((u) => u.id !== currentUserId)?.id ?? "",
  );
  const [percentages, setPercentages] = useState<Record<string, number>>(() =>
    computeDefaultPercentages(users, defaultSplit),
  );
  const [fixedAmounts, setFixedAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(users.map((u) => [u.id, 0])),
  );
  const [linkToTransaction, setLinkToTransaction] = useState(false);
  const [selectedRelatedTxId, setSelectedRelatedTxId] = useState<string | null>(null);
  const [relatedTxSearch, setRelatedTxSearch] = useState("");
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  const isEditing = props.editingId !== null;

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
    return computeDefaultPercentages(users, defaultSplit);
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

    const lastConfig = loadLastSplitConfig();
    if (lastConfig) {
      if (lastConfig.splitMode) {
        setSplitMode(lastConfig.splitMode as SplitMode);
      } else setSplitMode("percentage");
      setPercentages(lastConfig.percentages);
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
      setFixedAmounts(Object.fromEntries(users.map((u) => [u.id, 0])));
    }
  }

  function populateEdit(tx: EnrichedTransaction) {
    setAmount(tx.originalAmount);
    setAmountDisplay(tx.originalAmount.toString());
    setDescription(tx.description);
    setNotes(tx.notes || "");
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
      const total = splits.reduce((s, sp) => s + sp.amount, 0);
      const hasCustomPercentages = splits.some(
        (sp) => Math.abs(sp.percentage - 100 / splits.length) >= 0.5,
      );

      if (hasCustomPercentages) {
        const allFixed = Math.abs(total - tx.originalAmount) < 0.01;
        if (!allFixed) {
          setSplitMode("percentage");
          setPercentages(Object.fromEntries(splits.map((s) => [s.userId, s.percentage])));
        } else {
          setSplitMode("fixed");
          setFixedAmounts(Object.fromEntries(splits.map((s) => [s.userId, s.amount])));
        }
      } else {
        setSplitMode("auto");
      }
    }
  }

  function getSplits(): SplitEntry[] {
    const total = Math.abs(amount);
    const userIds = users.map((u) => u.id);
    if (splitMode === "auto") {
      return buildEqualSplit(total, userIds, splitSeed).splits;
    }
    if (splitMode === "percentage") {
      return buildPercentageSplit(
        total,
        users.map((u) => ({
          userId: u.id,
          percentage: percentages[u.id] ?? 0,
        })),
      ).splits;
    }
    return buildFixedSplit(
      total,
      users.map((u) => ({
        userId: u.id,
        amount: fixedAmounts[u.id] ?? 0,
      })),
    ).splits;
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

    if (props.editingId && props.modalMode !== "payment" && Math.abs(newVal - amount) > 0.001) {
      const currentSplits = getSplits();
      const total = Math.abs(amount);
      setPercentages(
        Object.fromEntries(
          currentSplits.map((s) => [
            s.userId,
            total > 0
              ? Math.round((s.amount / total) * 10000) / 100
              : Math.round(10000 / users.length) / 100,
          ]),
        ),
      );
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

    if (props.editingId && Math.abs(total - amount) > 0.001) {
      const currentSplits = getSplits();
      const currentTotal = Math.abs(amount);
      setPercentages(
        Object.fromEntries(
          currentSplits.map((s) => [
            s.userId,
            currentTotal > 0
              ? Math.round((s.amount / currentTotal) * 10000) / 100
              : Math.round(10000 / users.length) / 100,
          ]),
        ),
      );
      setSplitMode("percentage");
    }

    setAmount(total);
    return sanitized;
  }

  function totalPercentage(): number {
    return Object.values(percentages).reduce((s, v) => s + v, 0);
  }

  function autoComplementPercentage(userId: string) {
    if (users.length === 2) {
      const otherId = users.find((u) => u.id !== userId)?.id;
      if (otherId) {
        const newPcts = { ...percentages };
        newPcts[otherId] = Math.round((100 - (newPcts[userId] ?? 0)) * 100) / 100;
        if (newPcts[otherId] < 0) newPcts[otherId] = 0;
        setPercentages(newPcts);
      }
    }
  }

  function updatePercentage(userId: string, raw: string) {
    let v = Math.min(parseFloat(raw) || 0, 100);
    if (v < 0) v = 0;
    setPercentages({ ...percentages, [userId]: v });
    autoComplementPercentage(userId);
  }

  function autoComplementFixed(userId: string) {
    if (users.length === 2) {
      const otherId = users.find((u) => u.id !== userId)?.id;
      if (otherId) {
        const newAmounts = { ...fixedAmounts };
        newAmounts[otherId] =
          Math.round((Math.abs(amount) - (newAmounts[userId] ?? 0)) * 100) / 100;
        if (newAmounts[otherId] < 0) newAmounts[otherId] = 0;
        setFixedAmounts(newAmounts);
      }
    }
  }

  function updateFixedAmount(userId: string, raw: string) {
    const total = Math.abs(amount);
    let v = Math.min(parseFloat(raw) || 0, total);
    if (v < 0) v = 0;
    setFixedAmounts({ ...fixedAmounts, [userId]: v });
    autoComplementFixed(userId);
  }

  function setAutoSplit() {
    setSplitMode("auto");
    setPercentages(
      Object.fromEntries(users.map((u) => [u.id, Math.round((100 / users.length) * 100) / 100])),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      let splitJson: TransactionSplit;

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
        splitJson = { splits: getSplits() };
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

      if (wasEditing) {
        props.onTransactionsChange(transactions.map((t) => (t.id === wasEditing ? optimistic : t)));
      } else {
        props.onTransactionsChange([optimistic, ...transactions]);
      }

      if (optimisticTpEntries.length > 0) {
        const otherTps = transactionPayments.filter((tp) => tp.pagoId !== optimisticId);
        props.onTransactionPaymentsChange([...otherTps, ...optimisticTpEntries]);
      } else if (wasEditing) {
        props.onTransactionPaymentsChange(transactionPayments.filter((tp) => tp.pagoId !== wasEditing));
      }

      props.onClose();
      props.onRecalculate();

      if (props.isDemo) {
        if (!wasEditing) {
          const serverId = crypto.randomUUID();
          props.onTransactionsChange(
            transactions.map((t) =>
              t.id === optimisticId ? { ...optimistic, id: serverId, createdAt: new Date() } : t,
            ),
          );
          if (optimisticTpEntries.length > 0) {
            props.onTransactionPaymentsChange(
              transactionPayments.map((tp) =>
                tp.pagoId === optimisticId ? { ...tp, pagoId: serverId } : tp,
              ),
            );
          }
          props.onRecalculate();
        }
        return;
      }

      const form = new FormData();
      form.append("description", optimistic.description);
      form.append("amount", optimistic.amount.toString());
      form.append("originalAmount", optimistic.originalAmount.toString());
      form.append("type", optimistic.type);
      form.append("splitJson", JSON.stringify(splitJson));
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
      };
      const { lastModified: serverStamp, ...savedTx } = saved;
      if (serverStamp !== undefined) {
        props.onServerStamp?.(serverStamp ?? null);
      }
      const serverPaidBy = users.find((u) => u.id === savedTx.userPaid) ?? null;
      const serverCreatedAt =
        typeof savedTx.createdAt === "string" ? new Date(savedTx.createdAt) : savedTx.createdAt;
      props.onTransactionsChange(
        transactions.map((t) =>
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
            transactionPayments.map((tp) =>
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

    for (const tx of transactions) {
      if (tx.type === "pago" || tx.type === "ajuste") continue;
      if (tx.userPaid === uid) continue;

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
  }, [transactions, transactionPayments, props.editingId, userPaid, props.locale]);

  const hasEligibleTransactions = eligibleTransactions.length > 0;

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

  const splits = useMemo(() => getSplits(), [amount, users, splitMode, splitSeed, percentages, fixedAmounts]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const totalPct =
    splitMode === "percentage"
      ? totalPercentage()
      : splits.reduce((s, sp) => s + sp.percentage, 0);

  if (!props.isOpen) return null;

  return (
    <Modal
      onClose={props.onClose}
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
                (linkToTransaction &&
                  selectedRelatedTxId !== null &&
                  (() => {
                    const stx = selectedRelatedTx;
                    return stx !== null && Math.abs(amount) > stx.remainingDebt + 0.005;
                  })())
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
        className="p-4 sm:p-6 space-y-4 sm:space-y-8 overflow-y-auto max-h-[75vh]"
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-300" htmlFor="description">
            {t("modal.description")}
          </label>
          <input
            className="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
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
                className="block w-full pl-8 pr-4 py-2.5 bg-background border border-white/20 rounded-custom text-white text-lg font-semibold focus:ring-primary focus:border-primary"
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
                  Total: ${formatMoney(Math.abs(amount))} (
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
                  const formatted = formatMoney(debtToRecipient);
                  setAmount(debtToRecipient);
                  setAmountDisplay(formatted);
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
                    amount: formatMoney(debtToRecipient),
                  })}
                </span>
              </button>
            )}
          </div>
          {!isPago && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">{t("modal.type")}</label>
              <div
                className="flex gap-1 p-1 bg-background border border-white/20 rounded-custom"
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
                    className="block w-full px-4 py-2 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
                    value={installmentCurrent}
                    onChange={(e) => setInstallmentCurrent(parseInt(e.currentTarget.value))}
                  >
                    {Array.from({ length: installmentTotal }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                  <span className="text-zinc-500">{t("modal.installment_of")}</span>
                  <input
                    className="block w-20 px-4 py-2 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
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
                  <span className="text-zinc-500">{t("modal.installment_months")}</span>
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
              className="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
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

        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-300" htmlFor="notes">
            {t("modal.notes")}
          </label>
          <textarea
            className="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary resize-none"
            id="notes"
            rows={2}
            placeholder={t("modal.notes_placeholder")}
            value={notes}
            onInput={(e) => setNotes(e.currentTarget.value)}
          />
        </div>

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
                                style={{ backgroundColor: `${user.color}30`, color: user.color }}
                              >
                                {userInitials}
                              </div>
                              <span className="text-sm font-medium text-white">
                                {user.name}
                                {user.id === currentUserId && (
                                  <span className="text-zinc-500 ml-1">{t("common.you_label")}</span>
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
                              className="accent-primary"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
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
                              className="accent-indigo-400"
                            />
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
                                    <span className="text-xs font-semibold text-green-400">
                                      {t("modal.owes_you", {
                                        amount: formatMoney(bd.amount),
                                      })}
                                    </span>
                                  ) : (
                                    <span className="text-xs font-semibold text-red-400">
                                      {t("modal.you_owe_them", {
                                        amount: formatMoney(Math.abs(bd.amount)),
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
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[9px] text-zinc-500 uppercase">
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
                                setPaymentRecipient(
                                  users.find((u) => u.id !== user.id)?.id ?? "",
                                );
                              }
                            }}
                            className="accent-primary"
                          />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[9px] text-zinc-500 uppercase">
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
                            className="accent-indigo-400"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                              style={{ backgroundColor: `${user.color}30`, color: user.color }}
                            >
                              {userInitials}
                            </div>
                            <span className="text-sm font-medium text-white truncate">
                              {user.name}
                              {user.id === currentUserId && (
                                <span className="text-zinc-500 ml-1">{t("common.you_label")}</span>
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
                                bd.amount > 0 ? "text-green-400" : "text-red-400"
                              } ml-8`}
                            >
                              {bd.amount > 0
                                ? t("modal.owes_you", {
                                    amount: formatMoney(bd.amount),
                                  })
                                : t("modal.you_owe_them", {
                                    amount: formatMoney(Math.abs(bd.amount)),
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
              <label className="flex items-center gap-3 cursor-pointer select-none">
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
                  className="accent-primary w-4 h-4"
                />
                <span className="text-sm font-medium text-zinc-300">{t("modal.link_expenses")}</span>
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
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      className="w-full bg-background border-white/20 rounded-custom pl-9 pr-8 text-white text-sm placeholder-zinc-500 focus:ring-primary focus:border-primary py-2"
                    />
                    {relatedTxSearch && (
                      <button
                        type="button"
                        onClick={() => setRelatedTxSearch("")}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-white"
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
                              Distribución
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
                                            covered: formatMoney(a.amount),
                                            total: formatMoney(exp!.remainingDebt),
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
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
                {t("modal.split_section")}
              </h3>
              <div className="flex gap-2" data-tour="split-mode">
                <button
                  type="button"
                  onClick={setAutoSplit}
                  className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                    splitMode === "auto"
                      ? "bg-primary text-white shadow-sm"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {t("modal.split_auto")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (defaultSplit) {
                      setSplitMode("percentage");
                      setPercentages(buildDefaultPercentages());
                    } else {
                      setSplitMode("percentage");
                    }
                  }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                    splitMode === "percentage"
                      ? "bg-primary text-white shadow-sm"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {t("modal.split_percentage")}
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode("fixed")}
                  className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                    splitMode === "fixed"
                      ? "bg-primary text-white shadow-sm"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
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
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-400 w-32 text-right">%</th>
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
                              style={{ backgroundColor: `${user.color}30`, color: user.color }}
                            >
                              {userInitials}
                            </div>
                            <span className="text-sm font-medium text-white">
                              {user.name}
                              {user.id === currentUserId && (
                                <span className="text-zinc-500 ml-1">{t("common.you_label")}</span>
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
                                className="w-20 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                type="text"
                                inputMode="decimal"
                                value={percentages[user.id] ?? 0}
                                onInput={(e) => {
                                  const sanitized = sanitizeDecimal(e.currentTarget.value);
                                  e.currentTarget.value = sanitized;
                                  updatePercentage(user.id, sanitized);
                                }}
                              />
                            ) : (
                              <span className="text-sm text-zinc-400">
                                {split?.percentage.toFixed(0) ?? 0}
                              </span>
                            )}
                            <span className="ml-1 text-zinc-500">%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            {splitMode === "fixed" ? (
                              <input
                                className="w-28 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                type="text"
                                inputMode="decimal"
                                value={fixedAmounts[user.id] ?? 0}
                                onInput={(e) => {
                                  const sanitized = sanitizeDecimal(e.currentTarget.value);
                                  e.currentTarget.value = sanitized;
                                  updateFixedAmount(user.id, sanitized);
                                }}
                              />
                            ) : (
                              <span className="text-sm text-white">
                                {split?.amount.toFixed(2) ?? "0.00"}
                              </span>
                            )}
                            {splitMode === "fixed" && (
                              <span className="ml-1 text-zinc-500">$</span>
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
                      {t("modal.total_header")}
                    </td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-bold ${
                        Math.abs(totalPct - 100) < 0.01 ? "text-white" : "text-red-400"
                      }`}
                    >
                      {totalPct.toFixed(0)}%
                    </td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-bold ${
                        Math.abs(totalSplitAmount - Math.abs(amount)) < 0.01
                          ? "text-white"
                          : "text-red-400"
                      }`}
                    >
                      ${totalSplitAmount.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <div className="md:hidden divide-y divide-border-custom">
                {users.map((user) => {
                  const split = splits.find((s) => s.userId === user.id);
                  const userInitials = initials(user.name);
                  return (
                    <div key={user.id} className="flex items-start gap-3 px-3 py-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                            style={{ backgroundColor: `${user.color}30`, color: user.color }}
                          >
                            {userInitials}
                          </div>
                          <span className="text-sm font-medium text-white truncate">
                            {user.name}
                            {user.id === currentUserId && (
                              <span className="text-zinc-500 ml-1">{t("common.you_label")}</span>
                            )}
                            {props.entityIds.has(user.id) && (
                              <span className="text-xs ml-1 px-1 py-0.5 rounded bg-white/10 text-zinc-400">
                                {t("common.tercero_badge")}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center">
                            {splitMode === "percentage" ? (
                              <input
                                className="w-16 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                type="text"
                                inputMode="decimal"
                                value={percentages[user.id] ?? 0}
                                onInput={(e) => {
                                  const sanitized = sanitizeDecimal(e.currentTarget.value);
                                  e.currentTarget.value = sanitized;
                                  updatePercentage(user.id, sanitized);
                                }}
                              />
                            ) : (
                              <span className="text-zinc-400">{split?.percentage.toFixed(0) ?? 0}</span>
                            )}
                            <span className="ml-0.5 text-zinc-500 text-xs">%</span>
                          </div>
                          <div className="flex items-center">
                            {splitMode === "fixed" ? (
                              <input
                                className="w-24 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                type="text"
                                inputMode="decimal"
                                value={fixedAmounts[user.id] ?? 0}
                                onInput={(e) => {
                                  const sanitized = sanitizeDecimal(e.currentTarget.value);
                                  e.currentTarget.value = sanitized;
                                  updateFixedAmount(user.id, sanitized);
                                }}
                              />
                            ) : (
                              <span className="text-white">${(split?.amount ?? 0).toFixed(2)}</span>
                            )}
                            {splitMode === "fixed" && (
                              <span className="ml-0.5 text-zinc-500 text-xs">$</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between px-3 py-2 bg-white/5">
                  <span className="text-xs font-bold text-zinc-400 italic">
                    {t("modal.total_header")}
                  </span>
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-xs font-bold ${
                        Math.abs(totalPct - 100) < 0.01 ? "text-white" : "text-red-400"
                      }`}
                    >
                      {totalPct.toFixed(0)}%
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        Math.abs(totalSplitAmount - Math.abs(amount)) < 0.01
                          ? "text-white"
                          : "text-red-400"
                      }`}
                    >
                      ${totalSplitAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </form>
    </Modal>
  );
}
