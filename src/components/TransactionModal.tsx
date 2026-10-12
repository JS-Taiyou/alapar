import {
  type Signal,
  useComputed,
  useSignal,
  useSignalEffect,
} from "@preact/signals";
import { useRef } from "preact/hooks";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  SplitEntry,
  TransactionPayment,
  TransactionSplit,
} from "../lib/types";
import type { EnrichedTransaction } from "../islands/shared-signals";
import {
  buildEqualSplit,
  buildFixedSplit,
  buildPercentageSplit,
  computeDefaultPercentages,
} from "../lib/calculations";
import {
  formatMoney,
  initials,
  sanitizeDecimal,
  sanitizeInteger,
} from "../lib/format";
import Modal from "./Modal";
import { showUpgradeToast } from "../islands/Toaster";
import { formatDate, type Locale, t as translate } from "../lib/i18n";

interface TransactionModalProps {
  isOpen: Signal<boolean>;
  editingId: Signal<string | null>;
  modalMode: Signal<"expense" | "payment">;
  transactions: Signal<EnrichedTransaction[]>;
  users: Signal<Participant[]>;
  currentUserId: Signal<string>;
  registryId: Signal<string>;
  balanceEntries: Signal<BalanceBreakdownEntry[]>;
  defaultSplit: Signal<DefaultSplit | null>;
  entityIds: Signal<Set<string>>;
  entities: Signal<{ id: string; name: string; color: string }[]>;
  transactionPayments: Signal<TransactionPayment[]>;
  onRecalculate: () => void;
  /**
   * Receives the registry's fresh `last_modified` returned by mutation
   * endpoints, so the caller can label its cached snapshot with the version
   * its own write produced (a stale label forces a redundant refetch on the
   * next sync). Called with null when the server reports no stamp.
   */
  onServerStamp?: (stamp: string | null) => void;
  isDemo?: boolean;
  locale?: Locale;
}

type SplitMode = "auto" | "percentage" | "fixed";
type TransactionType =
  | "unico"
  | "parcialidad"
  | "recurrente"
  | "pago"
  | "ajuste";

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

  const submitting = useSignal(false);
  const amount = useSignal(0);
  const amountDisplay = useSignal("");
  const description = useSignal("");
  const notes = useSignal("");
  const expenseType = useSignal<TransactionType>("unico");
  const installmentCurrent = useSignal(1);
  const installmentTotal = useSignal(12);
  const installmentTotalDisplay = useSignal("12");
  const installmentInputMode = useSignal<"total" | "installment">("total");
  const installmentAmount = useSignal(0);
  const installmentAmountDisplay = useSignal("");
  const splitMode = useSignal<SplitMode>("auto");
  const splitSeed = useSignal<string>(crypto.randomUUID());
  const userPaid = useSignal(currentUserId.value);
  const paymentRecipient = useSignal<string>(
    users.value.find((u) => u.id !== currentUserId.value)?.id ?? "",
  );
  const percentages = useSignal<Record<string, number>>(
    computeDefaultPercentages(users.value, defaultSplit.value),
  );
  const fixedAmounts = useSignal<Record<string, number>>(
    Object.fromEntries(users.value.map((u) => [u.id, 0])),
  );
  const linkToTransaction = useSignal(false);
  const selectedRelatedTxId = useSignal<string | null>(null);
  const relatedTxSearch = useSignal("");
  const selectedExpenseIds = useSignal<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  const isEditing = useComputed(() => props.editingId.value !== null);

  const hasInitialized = useSignal(false);
  // Set when the modal is reopened after a failed submit: the form signals
  // still hold everything the user typed, so the reset/populate path must be
  // skipped or their input would be lost.
  const reopenWithoutReset = useSignal(false);

  useSignalEffect(() => {
    if (!props.isOpen.value) {
      hasInitialized.value = false;
      return;
    }
    if (hasInitialized.value) return;
    hasInitialized.value = true;

    if (reopenWithoutReset.value) {
      reopenWithoutReset.value = false;
      return;
    }

    const txId = props.editingId.value;
    if (txId) {
      const tx = transactions.value.find((t) => t.id === txId);
      if (tx) populateEdit(tx);
    } else {
      resetForm();
    }
  });

  useSignalEffect(() => {
    const count = selectedExpenseIds.value.length;
    if (count === 0) return;
    const form = formRef.current;
    if (!form) return;
    requestAnimationFrame(() => {
      form.scrollTo({ top: form.scrollHeight, behavior: "smooth" });
    });
  });

  useSignalEffect(() => {
    if (amount.value === 0 && linkToTransaction.value) {
      linkToTransaction.value = false;
      selectedRelatedTxId.value = null;
      selectedExpenseIds.value = [];
    }
  });

  function buildDefaultPercentages(): Record<string, number> {
    return computeDefaultPercentages(users.value, defaultSplit.value);
  }

  function saveLastSplitConfig() {
    if (props.modalMode.value === "payment") return;
    const key = `lastSplit_${registryId.value}`;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          percentages: percentages.value,
          splitMode: splitMode.value,
          userPaid: userPaid.value,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch { /* ignore storage errors */ }
  }

  function loadLastSplitConfig(): {
    percentages: Record<string, number>;
    splitMode?: string;
    userPaid: string;
  } | null {
    const key = `lastSplit_${registryId.value}`;
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
    amount.value = 0;
    amountDisplay.value = "";
    description.value = "";
    notes.value = "";
    expenseType.value = "unico";
    installmentCurrent.value = 1;
    installmentTotal.value = 12;
    installmentTotalDisplay.value = "12";
    installmentInputMode.value = "total";
    installmentAmount.value = 0;
    installmentAmountDisplay.value = "";
    paymentRecipient.value =
      users.value.find((u) => u.id !== currentUserId.value)?.id ?? "";
    linkToTransaction.value = false;
    selectedRelatedTxId.value = null;
    relatedTxSearch.value = "";
    selectedExpenseIds.value = [];

    const lastConfig = loadLastSplitConfig();
    if (lastConfig) {
      if (lastConfig.splitMode) {
        splitMode.value = lastConfig.splitMode as SplitMode;
      } else splitMode.value = "percentage";
      percentages.value = lastConfig.percentages;
      userPaid.value = lastConfig.userPaid;
    } else {
      userPaid.value = currentUserId.value;
      if (
        defaultSplit.value &&
        defaultSplit.value.splits.length === users.value.length
      ) {
        splitMode.value = "percentage";
        percentages.value = buildDefaultPercentages();
      } else {
        splitMode.value = "auto";
        percentages.value = buildDefaultPercentages();
      }
      fixedAmounts.value = Object.fromEntries(
        users.value.map((u) => [u.id, 0]),
      );
    }
  }

  function populateEdit(tx: EnrichedTransaction) {
    amount.value = tx.originalAmount;
    amountDisplay.value = tx.originalAmount.toString();
    description.value = tx.description;
    notes.value = tx.notes || "";
    if (tx.type !== "pago") expenseType.value = tx.type;
    installmentCurrent.value = tx.installmentCurrent ?? 1;
    installmentTotal.value = tx.installmentTotal ?? 12;
    installmentTotalDisplay.value = (tx.installmentTotal ?? 12).toString();
    installmentInputMode.value = "total";
    installmentAmount.value = tx.installmentTotal
      ? Math.round((tx.originalAmount / tx.installmentTotal) * 100) / 100
      : 0;
    installmentAmountDisplay.value = installmentAmount.value
      ? installmentAmount.value.toString()
      : "";
    userPaid.value = tx.userPaid;

    if (tx.type === "pago") {
      const recipientSplit = tx.splitJson.splits[0];
      if (recipientSplit) {
        paymentRecipient.value = recipientSplit.userId;
      }
      const pagoTps = transactionPayments.value.filter(
        (tp) => tp.pagoId === tx.id,
      );
      if (pagoTps.length > 0) {
        linkToTransaction.value = true;
        selectedExpenseIds.value = pagoTps.map((tp) => tp.expenseId);
        selectedRelatedTxId.value = null;
      } else if (tx.relatedTransactionId) {
        linkToTransaction.value = true;
        selectedExpenseIds.value = [tx.relatedTransactionId];
        selectedRelatedTxId.value = tx.relatedTransactionId;
      } else {
        linkToTransaction.value = false;
        selectedExpenseIds.value = [];
        selectedRelatedTxId.value = null;
      }
    } else {
      const splits = tx.splitJson.splits;
      const total = splits.reduce((s, sp) => s + sp.amount, 0);
      const hasCustomPercentages = splits.some((sp) =>
        Math.abs(sp.percentage - (100 / splits.length)) >= 0.5
      );

      if (hasCustomPercentages) {
        const allFixed = Math.abs(total - tx.originalAmount) < 0.01;
        if (!allFixed) {
          splitMode.value = "percentage";
          percentages.value = Object.fromEntries(
            splits.map((s) => [s.userId, s.percentage]),
          );
        } else {
          splitMode.value = "fixed";
          fixedAmounts.value = Object.fromEntries(
            splits.map((s) => [s.userId, s.amount]),
          );
        }
      } else {
        splitMode.value = "auto";
      }
    }
  }

  function getSplits(): SplitEntry[] {
    const total = Math.abs(amount.value);
    const userIds = users.value.map((u) => u.id);
    if (splitMode.value === "auto") {
      return buildEqualSplit(total, userIds, splitSeed.value).splits;
    }
    if (splitMode.value === "percentage") {
      return buildPercentageSplit(
        total,
        users.value.map((u) => ({
          userId: u.id,
          percentage: percentages.value[u.id] ?? 0,
        })),
      ).splits;
    }
    return buildFixedSplit(
      total,
      users.value.map((u) => ({
        userId: u.id,
        amount: fixedAmounts.value[u.id] ?? 0,
      })),
    ).splits;
  }

  function computeAllocation(
    totalAmount: number,
    expenseIds: string[],
  ): Array<{ expenseId: string; amount: number }> {
    if (expenseIds.length === 0 || totalAmount <= 0) return [];
    const expenses = expenseIds
      .map((id) => eligibleTransactions.value.find((e) => e.id === id))
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
    const ids = selectedExpenseIds.value;
    if (ids.length <= 1) return;
    const totalAmount = Math.abs(amount.value);
    const expenses = ids
      .map((id) => eligibleTransactions.value.find((e) => e.id === id))
      .filter((e): e is EligibleTransaction => e !== undefined)
      .sort((a, b) => a.remainingDebt - b.remainingDebt);

    while (expenses.length > 1) {
      const nMinus1Sum = expenses.slice(0, expenses.length - 1).reduce(
        (s, e) => s + e.remainingDebt,
        0,
      );
      if (totalAmount >= nMinus1Sum) break;
      const removed = expenses.pop()!;
      selectedExpenseIds.value = selectedExpenseIds.value.filter(
        (id) => id !== removed.id,
      );
    }
  }

  function handleAmountChange(raw: string) {
    const sanitized = sanitizeDecimal(raw);
    const newVal = parseFloat(sanitized) || 0;

    if (
      props.editingId.value &&
      props.modalMode.value !== "payment" &&
      Math.abs(newVal - amount.value) > 0.001
    ) {
      const currentSplits = getSplits();
      const total = Math.abs(amount.value);
      percentages.value = Object.fromEntries(
        currentSplits.map((s) => [
          s.userId,
          total > 0
            ? Math.round((s.amount / total) * 10000) / 100
            : Math.round(10000 / users.value.length) / 100,
        ]),
      );
      splitMode.value = "percentage";
    }

    amount.value = newVal;
    amountDisplay.value = sanitized;
    if (props.modalMode.value === "payment" && linkToTransaction.value) {
      enforceSelectionConstraint();
    }
    return sanitized;
  }

  function handleInstallmentAmountChange(raw: string) {
    const sanitized = sanitizeDecimal(raw);
    const newVal = parseFloat(sanitized) || 0;
    installmentAmount.value = newVal;
    installmentAmountDisplay.value = sanitized;
    const total = Math.round(newVal * installmentTotal.value * 100) / 100;

    if (
      props.editingId.value &&
      Math.abs(total - amount.value) > 0.001
    ) {
      const currentSplits = getSplits();
      const currentTotal = Math.abs(amount.value);
      percentages.value = Object.fromEntries(
        currentSplits.map((s) => [
          s.userId,
          currentTotal > 0
            ? Math.round((s.amount / currentTotal) * 10000) / 100
            : Math.round(10000 / users.value.length) / 100,
        ]),
      );
      splitMode.value = "percentage";
    }

    amount.value = total;
    return sanitized;
  }

  function totalPercentage(): number {
    return Object.values(percentages.value).reduce((s, v) => s + v, 0);
  }

  function autoComplementPercentage(userId: string) {
    if (users.value.length === 2) {
      const otherId = users.value.find((u) => u.id !== userId)?.id;
      if (otherId) {
        const newPcts = { ...percentages.value };
        newPcts[otherId] = Math.round((100 - (newPcts[userId] ?? 0)) * 100) /
          100;
        if (newPcts[otherId] < 0) newPcts[otherId] = 0;
        percentages.value = newPcts;
      }
    }
  }

  function updatePercentage(userId: string, raw: string) {
    let v = Math.min(parseFloat(raw) || 0, 100);
    if (v < 0) v = 0;
    percentages.value = { ...percentages.value, [userId]: v };
    autoComplementPercentage(userId);
  }

  function autoComplementFixed(userId: string) {
    if (users.value.length === 2) {
      const otherId = users.value.find((u) => u.id !== userId)?.id;
      if (otherId) {
        const newAmounts = { ...fixedAmounts.value };
        newAmounts[otherId] = Math.round(
          (Math.abs(amount.value) - (newAmounts[userId] ?? 0)) * 100,
        ) / 100;
        if (newAmounts[otherId] < 0) newAmounts[otherId] = 0;
        fixedAmounts.value = newAmounts;
      }
    }
  }

  function updateFixedAmount(userId: string, raw: string) {
    const total = Math.abs(amount.value);
    let v = Math.min(parseFloat(raw) || 0, total);
    if (v < 0) v = 0;
    fixedAmounts.value = { ...fixedAmounts.value, [userId]: v };
    autoComplementFixed(userId);
  }

  function setAutoSplit() {
    splitMode.value = "auto";
    percentages.value = Object.fromEntries(
      users.value.map((
        u,
      ) => [u.id, Math.round((100 / users.value.length) * 100) / 100]),
    );
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (submitting.value) return;
    submitting.value = true;
    try {
      let splitJson: TransactionSplit;

      if (props.modalMode.value === "payment") {
        splitJson = {
          splits: [{
            userId: paymentRecipient.value,
            percentage: 100,
            amount: Math.abs(amount.value),
          }],
        };
      } else {
        splitJson = { splits: getSplits() };
      }

      const paidByUser = users.value.find((u) => u.id === userPaid.value) ??
        null;

      const optimisticId = props.editingId.value ?? crypto.randomUUID();

      const currentAllocation = props.modalMode.value === "payment" &&
          linkToTransaction.value
        ? computeAllocation(Math.abs(amount.value), selectedExpenseIds.value)
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
        registry_id: registryId.value,
        description: description.value || t("modal.default_payment_desc"),
        amount: amount.value,
        originalAmount: Math.abs(amount.value),
        type: props.modalMode.value === "payment" ? "pago" : expenseType.value,
        exerciseId: null,
        installmentCurrent: expenseType.value === "parcialidad"
          ? installmentCurrent.value
          : null,
        installmentTotal: expenseType.value === "parcialidad"
          ? installmentTotal.value
          : null,
        recurringDisabled: false,
        recurringGroupId: optimisticId,
        notes: notes.value,
        splitJson,
        creatorId: currentUserId.value,
        userPaid: userPaid.value,
        relatedTransactionId:
          linkToTransaction.value && selectedExpenseIds.value.length === 1
            ? selectedExpenseIds.value[0]
            : null,
        createdAt: new Date(),
        paidByUser,
      };

      const wasEditing = props.editingId.value;
      // Pre-optimistic snapshots: if the server rejects the write (4xx or
      // network), the optimistic row must not linger in the list — it would
      // also be persisted to the IndexedDB snapshot and shown as real.
      const prevTransactions = transactions.value;
      const prevTps = transactionPayments.value;

      if (wasEditing) {
        transactions.value = transactions.value.map((t) =>
          t.id === wasEditing ? optimistic : t
        );
      } else {
        transactions.value = [optimistic, ...transactions.value];
      }

      if (optimisticTpEntries.length > 0) {
        const otherTps = transactionPayments.value.filter(
          (tp) => tp.pagoId !== optimisticId,
        );
        transactionPayments.value = [...otherTps, ...optimisticTpEntries];
      } else if (wasEditing) {
        transactionPayments.value = transactionPayments.value.filter(
          (tp) => tp.pagoId !== wasEditing,
        );
      }

      props.isOpen.value = false;
      props.editingId.value = null;
      props.onRecalculate();

      if (props.isDemo) {
        if (!wasEditing) {
          const serverId = crypto.randomUUID();
          transactions.value = transactions.value.map((t) =>
            t.id === optimisticId
              ? { ...optimistic, id: serverId, createdAt: new Date() }
              : t
          );
          if (optimisticTpEntries.length > 0) {
            transactionPayments.value = transactionPayments.value.map((tp) =>
              tp.pagoId === optimisticId ? { ...tp, pagoId: serverId } : tp
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
        form.append("installmentCurrent", installmentCurrent.value.toString());
        form.append("installmentTotal", installmentTotal.value.toString());
      }
      if (optimistic.relatedTransactionId) {
        form.append("relatedTransactionId", optimistic.relatedTransactionId);
      }
      if (currentAllocation.length > 0) {
        form.append("transactionPayments", JSON.stringify(currentAllocation));
      } else if (wasEditing && props.modalMode.value === "payment") {
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
        alert(
          detail
            ? `${t("modal.save_error")}\n${detail}`
            : t("modal.save_error"),
        );
        return;
      }

      const saved = await res.json() as EnrichedTransaction & {
        lastModified?: string | null;
      };
      const { lastModified: serverStamp, ...savedTx } = saved;
      if (serverStamp !== undefined) {
        props.onServerStamp?.(serverStamp ?? null);
      }
      const serverPaidBy = users.value.find((u) => u.id === savedTx.userPaid) ??
        null;
      const serverCreatedAt = typeof savedTx.createdAt === "string"
        ? new Date(savedTx.createdAt)
        : savedTx.createdAt;
      transactions.value = transactions.value.map((t) =>
        t.id === (wasEditing ?? optimisticId)
          ? {
            ...savedTx,
            paidByUser: serverPaidBy,
            createdAt: serverCreatedAt,
          }
          : t
      );
      if (!wasEditing) {
        const serverId = savedTx.id as string;
        if (serverId && serverId !== optimisticId) {
          transactionPayments.value = transactionPayments.value.map((tp) =>
            tp.pagoId === optimisticId ? { ...tp, pagoId: serverId } : tp
          );
        }
        saveLastSplitConfig();
      }
      props.onRecalculate();
    } finally {
      submitting.value = false;
    }
  }

  /**
   * Undo the optimistic write after a rejected submit and reopen the modal
   * with the user's input still in the form (signals were never cleared).
   */
  function rollbackSubmit(
    prevTransactions: EnrichedTransaction[],
    prevTps: TransactionPayment[],
    wasEditing: string | null,
  ) {
    transactions.value = prevTransactions;
    transactionPayments.value = prevTps;
    props.onRecalculate();
    reopenWithoutReset.value = true;
    props.editingId.value = wasEditing;
    props.isOpen.value = true;
  }

  async function handleDelete() {
    if (!props.editingId.value) return;
    if (!confirm(t("modal.delete_confirm"))) return;
    if (submitting.value) return;
    submitting.value = true;
    try {
      const id = props.editingId.value;
      const index = transactions.value.findIndex((t) => t.id === id);
      if (index === -1) return;
      const removed = transactions.value[index];

      transactions.value = transactions.value.filter((t) => t.id !== id);
      props.isOpen.value = false;
      props.editingId.value = null;
      props.onRecalculate();

      if (props.isDemo) return;

      const restore = () => {
        const restored = [...transactions.value];
        restored.splice(Math.min(index, restored.length), 0, removed);
        transactions.value = restored;
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
          const data = await res.json() as { lastModified?: string | null };
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
      submitting.value = false;
    }
  }

  const eligibleTransactions = useComputed(() => {
    const uid = userPaid.value;
    const debtMap = new Map<
      string,
      { tx: EnrichedTransaction; debt: number }
    >();

    for (const tx of transactions.value) {
      if (tx.type === "pago" || tx.type === "ajuste") continue;
      if (tx.userPaid === uid) continue;

      const userSplit = tx.splitJson.splits.find((s) => s.userId === uid);
      if (!userSplit) continue;

      const divisor = tx.type === "parcialidad" && tx.installmentTotal
        ? tx.installmentTotal
        : 1;
      const debt = userSplit.amount / divisor;

      if (debt > 0.005) {
        debtMap.set(tx.id, { tx, debt });
      }
    }

    for (const tx of transactions.value) {
      if (tx.type !== "pago") continue;
      if (tx.userPaid !== uid) continue;
      if (tx.id === (props.editingId.value ?? undefined)) continue;

      const pagoTps = transactionPayments.value.filter(
        (tp) => tp.pagoId === tx.id,
      );
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
            const d = tx.type === "parcialidad" && tx.installmentTotal
              ? tx.installmentTotal
              : 1;
            return us.amount / d;
          })(),
          remainingDebt: Math.round(debt * 100) / 100,
          createdAt: tx.createdAt,
        });
      }
    }

    result.sort((a, b) => a.remainingDebt - b.remainingDebt);
    return result;
  });

  const hasEligibleTransactions = useComputed(() =>
    eligibleTransactions.value.length > 0
  );

  const filteredEligible = useComputed(() => {
    const list = eligibleTransactions.value;
    if (!relatedTxSearch.value.trim()) return list;
    const q = relatedTxSearch.value.trim().toLowerCase();
    return list.filter((e) =>
      e.description.toLowerCase().includes(q) ||
      e.paidByUser.toLowerCase().includes(q)
    );
  });

  const selectedRelatedTx = useComputed(() => {
    if (!selectedRelatedTxId.value) return null;
    return eligibleTransactions.value.find((e) =>
      e.id === selectedRelatedTxId.value
    ) ?? null;
  });

  const splits = useComputed(() => getSplits());

  const isPago = props.modalMode.value === "payment";

  const debtToRecipient = isPago
    ? (() => {
      if (userPaid.value === currentUserId.value) {
        const entry = props.balanceEntries.value.find((b) =>
          b.userId === paymentRecipient.value
        );
        return entry && entry.amount < -0.005 ? Math.abs(entry.amount) : 0;
      }
      if (paymentRecipient.value === currentUserId.value) {
        const entry = props.balanceEntries.value.find((b) =>
          b.userId === userPaid.value
        );
        return entry && entry.amount > 0.005 ? entry.amount : 0;
      }
      return 0;
    })()
    : 0;

  const modalTitle = isPago
    ? (isEditing.value ? t("modal.edit_payment") : t("modal.new_payment"))
    : (isEditing.value ? t("modal.edit_expense") : t("modal.new_expense"));
  const modalSubtitle = isPago
    ? (isEditing.value
      ? t("modal.edit_payment_subtitle")
      : t("modal.new_payment_subtitle"))
    : (isEditing.value
      ? t("modal.edit_expense_subtitle")
      : t("modal.new_expense_subtitle"));

  const totalSplitAmount = splits.value.reduce((s, sp) => s + sp.amount, 0);
  const totalPct = splitMode.value === "percentage"
    ? totalPercentage()
    : splits.value.reduce((s, sp) => s + sp.percentage, 0);

  if (!props.isOpen.value) return null;

  return (
    <Modal
      onClose={() => {
        props.isOpen.value = false;
        props.editingId.value = null;
      }}
      title={modalTitle}
      subtitle={modalSubtitle}
      widthClass="max-w-2xl"
      closeOnBackdrop={false}
      footer={
        <>
          <div>
            {isEditing.value && (
              <button
                type="button"
                disabled={submitting.value}
                onClick={handleDelete}
                class="px-4 py-2 text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {t("common.delete")}
              </button>
            )}
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                props.isOpen.value = false;
                props.editingId.value = null;
              }}
              class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={submitting.value ||
                (linkToTransaction.value &&
                  selectedRelatedTxId.value !== null &&
                  (() => {
                    const stx = selectedRelatedTx.value;
                    return stx !== null &&
                      Math.abs(amount.value) > stx.remainingDebt + 0.005;
                  })())}
              onClick={handleSubmit}
              class={`px-8 py-2 text-sm font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50 ${
                isPago
                  ? "bg-indigo-500 hover:bg-indigo-400 text-white"
                  : "bg-primary hover:bg-primary-light text-white"
              }`}
            >
              {submitting.value ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        class="p-4 sm:p-6 space-y-4 sm:space-y-8 overflow-y-auto max-h-[75vh]"
      >
        <div class="space-y-2">
          <label
            class="block text-sm font-medium text-zinc-300"
            for="description"
          >
            {t("modal.description")}
          </label>
          <input
            class="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
            id="description"
            type="text"
            placeholder={isPago
              ? t("modal.description_payment_placeholder")
              : t("modal.description_expense_placeholder")}
            value={description.value}
            onInput={(e) =>
              description.value = (e.target as HTMLInputElement).value}
            {...(isPago ? {} : { required: true })}
          />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
          <div class="space-y-2">
            <label
              class="block text-sm font-medium text-zinc-300"
              for="total-amount"
            >
              {isPago
                ? t("modal.amount_payment")
                : expenseType.value === "parcialidad" &&
                    installmentInputMode.value === "installment"
                ? t("modal.amount_installment")
                : t("modal.amount_total")}
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                $
              </span>
              <input
                class="block w-full pl-8 pr-4 py-2.5 bg-background border border-white/20 rounded-custom text-white text-lg font-semibold focus:ring-primary focus:border-primary"
                id="total-amount"
                type="text"
                inputmode="decimal"
                value={expenseType.value === "parcialidad" &&
                    installmentInputMode.value === "installment"
                  ? installmentAmountDisplay.value ||
                    installmentAmount.value || ""
                  : amountDisplay.value || amount.value || ""}
                onInput={(e) => {
                  if (
                    expenseType.value === "parcialidad" &&
                    installmentInputMode.value === "installment"
                  ) {
                    const sanitized = handleInstallmentAmountChange(
                      (e.target as HTMLInputElement).value,
                    );
                    (e.target as HTMLInputElement).value = sanitized;
                  } else {
                    const sanitized = handleAmountChange(
                      (e.target as HTMLInputElement).value,
                    );
                    (e.target as HTMLInputElement).value = sanitized;
                  }
                }}
                onBlur={(e) => {
                  const val =
                    parseFloat((e.target as HTMLInputElement).value) || 0;
                  (e.target as HTMLInputElement).value = val === 0
                    ? ""
                    : val.toString();
                  if (
                    expenseType.value === "parcialidad" &&
                    installmentInputMode.value === "installment"
                  ) {
                    installmentAmountDisplay.value = val === 0
                      ? ""
                      : val.toString();
                  } else {
                    amountDisplay.value = val === 0 ? "" : val.toString();
                  }
                }}
                required
              />
            </div>
            {expenseType.value === "parcialidad" &&
              installmentInputMode.value === "installment" &&
              installmentTotal.value > 0 && (
              <p class="text-xs text-zinc-400 mt-1">
                Total: ${formatMoney(Math.abs(amount.value))}{" "}
                ({t("modal.installment_count", {
                  n: installmentTotal.value,
                })})
              </p>
            )}
            {isPago && debtToRecipient > 0 && (
              <button
                type="button"
                data-tour="pay-debt"
                onClick={() => {
                  const formatted = formatMoney(debtToRecipient);
                  amount.value = debtToRecipient;
                  amountDisplay.value = formatted;
                }}
                class="flex items-center gap-2 mt-1.5 px-3 py-1.5 rounded-custom border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer group"
              >
                <svg
                  class="h-3.5 w-3.5 text-emerald-400 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <span class="text-xs font-medium text-emerald-300">
                  {t("modal.pay_debt", {
                    amount: formatMoney(debtToRecipient),
                  })}
                </span>
              </button>
            )}
          </div>
          {!isPago && (
            <div class="space-y-2">
              <label class="block text-sm font-medium text-zinc-300">
                {t("modal.type")}
              </label>
              <div
                class="flex gap-1 p-1 bg-background border border-white/20 rounded-custom"
                data-tour="expense-type"
              >
                {([
                  "unico",
                  "parcialidad",
                  "recurrente",
                ] as TransactionType[]).map((typeVal) => (
                  <button
                    key={typeVal}
                    type="button"
                    onClick={() => expenseType.value = typeVal}
                    class={`flex-1 py-2 text-sm font-medium rounded-custom transition-colors ${
                      expenseType.value === typeVal
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

        {expenseType.value === "parcialidad" && (
          <div class="space-y-3 sm:space-y-4">
            <div class="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  installmentInputMode.value = "total";
                }}
                class={`flex-1 py-1.5 text-xs font-medium rounded-custom transition-colors border ${
                  installmentInputMode.value === "total"
                    ? "bg-primary/20 border-primary text-white"
                    : "bg-background border-white/20 text-zinc-400 hover:text-white"
                }`}
              >
                {t("modal.installment_mode_total")}
              </button>
              <button
                type="button"
                onClick={() => {
                  installmentInputMode.value = "installment";
                  if (installmentAmount.value === 0 && amount.value > 0) {
                    installmentAmount.value = Math.round(
                      (amount.value / installmentTotal.value) * 100,
                    ) /
                      100;
                  }
                }}
                class={`flex-1 py-1.5 text-xs font-medium rounded-custom transition-colors border ${
                  installmentInputMode.value === "installment"
                    ? "bg-primary/20 border-primary text-white"
                    : "bg-background border-white/20 text-zinc-400 hover:text-white"
                }`}
              >
                {t("modal.installment_mode_per")}
              </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
              <div class="space-y-2">
                <label class="block text-sm font-medium text-zinc-300">
                  {t("modal.installment_current")}
                </label>
                <div class="flex items-center gap-3">
                  <select
                    class="block w-full px-4 py-2 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
                    value={installmentCurrent.value}
                    onChange={(e) =>
                      installmentCurrent.value = parseInt(
                        (e.target as HTMLSelectElement).value,
                      )}
                  >
                    {Array.from(
                      { length: installmentTotal.value },
                      (_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                      ),
                    )}
                  </select>
                  <span class="text-zinc-500">
                    {t("modal.installment_of")}
                  </span>
                  <input
                    class="block w-20 px-4 py-2 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
                    type="text"
                    inputmode="numeric"
                    value={installmentTotalDisplay.value}
                    onInput={(e) => {
                      const sanitized = sanitizeInteger(
                        (e.target as HTMLInputElement).value,
                      );
                      (e.target as HTMLInputElement).value = sanitized;
                      installmentTotalDisplay.value = sanitized;
                      const newTotal = parseInt(sanitized) || 0;
                      if (newTotal > 0) {
                        installmentTotal.value = newTotal;
                      }
                      if (
                        installmentInputMode.value === "installment" &&
                        newTotal > 0
                      ) {
                        amount.value = Math.round(
                          installmentAmount.value * newTotal * 100,
                        ) / 100;
                      }
                    }}
                    onBlur={(e) => {
                      const val =
                        parseInt((e.target as HTMLInputElement).value) ||
                        0;
                      const clamped = val < 1 ? 1 : val;
                      (e.target as HTMLInputElement).value = clamped
                        .toString();
                      installmentTotalDisplay.value = clamped.toString();
                      installmentTotal.value = clamped;
                      if (installmentInputMode.value === "installment") {
                        amount.value = Math.round(
                          installmentAmount.value * clamped * 100,
                        ) / 100;
                      }
                    }}
                  />
                  <span class="text-zinc-500">
                    {t("modal.installment_months")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isPago && (
          <div class="space-y-2">
            <label
              class="block text-sm font-medium text-zinc-300"
              for="payer-select"
            >
              {t("modal.payer")}
            </label>
            <select
              id="payer-select"
              class="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
              value={userPaid.value}
              onChange={(e) =>
                userPaid.value = (e.target as HTMLSelectElement).value}
            >
              {users.value.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                  {user.id === currentUserId.value
                    ? ` ${t("common.you_label")}`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div class="space-y-2">
          <label
            class="block text-sm font-medium text-zinc-300"
            for="notes"
          >
            {t("modal.notes")}
          </label>
          <textarea
            class="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary resize-none"
            id="notes"
            rows={2}
            placeholder={t("modal.notes_placeholder")}
            value={notes.value}
            onInput={(e) =>
              notes.value = (e.target as HTMLTextAreaElement).value}
          />
        </div>

        {isPago
          ? (
            <>
              <section class="space-y-3 sm:space-y-4">
                <h3 class="text-sm font-bold uppercase tracking-wider text-zinc-400">
                  {t("modal.transfer_section")}
                </h3>
                <div class="border border-white/10 rounded-custom overflow-hidden">
                  <table class="hidden md:table w-full text-left border-collapse">
                    <thead class="bg-white/5">
                      <tr>
                        <th class="px-4 py-3 text-xs font-semibold text-zinc-400">
                          {t("modal.user_header")}
                        </th>
                        <th class="px-4 py-3 text-xs font-semibold text-zinc-400 w-24 text-center">
                          {t("modal.paid_header")}
                        </th>
                        <th class="px-4 py-3 text-xs font-semibold text-zinc-400 w-24 text-center">
                          {t("modal.received_header")}
                        </th>
                        {users.value.length > 2 && (
                          <th class="px-4 py-3 text-xs font-semibold text-zinc-400 text-right">
                            {t("modal.balance_header")}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-border-custom">
                      {users.value.map((user) => {
                        const userInitials = initials(user.name);
                        return (
                          <tr key={user.id}>
                            <td class="px-4 py-3">
                              <div class="flex items-center gap-3">
                                <div
                                  class="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                  style={`background-color: ${user.color}30; color: ${user.color}`}
                                >
                                  {userInitials}
                                </div>
                                <span class="text-sm font-medium text-white">
                                  {user.name}
                                  {user.id === currentUserId.value && (
                                    <span class="text-zinc-500 ml-1">
                                      {t("common.you_label")}
                                    </span>
                                  )}
                                  {props.entityIds.value.has(user.id) && (
                                    <span class="text-xs ml-1 px-1.5 py-0.5 rounded bg-white/10 text-zinc-400">
                                      {t("common.tercero_badge")}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </td>
                            <td class="px-4 py-3 text-center">
                              <input
                                type="radio"
                                name="pagoPaid"
                                value={user.id}
                                checked={userPaid.value === user.id}
                                onChange={() => {
                                  userPaid.value = user.id;
                                  if (
                                    paymentRecipient.value === user.id
                                  ) {
                                    paymentRecipient.value =
                                      users.value.find((u) => u.id !== user.id)
                                        ?.id ?? "";
                                  }
                                }}
                                class="accent-primary"
                              />
                            </td>
                            <td class="px-4 py-3 text-center">
                              <input
                                type="radio"
                                name="pagoRecipient"
                                value={user.id}
                                checked={paymentRecipient.value ===
                                  user.id}
                                onChange={() => {
                                  paymentRecipient.value = user.id;
                                  if (userPaid.value === user.id) {
                                    userPaid.value = users.value.find((u) =>
                                      u.id !== user.id
                                    )?.id ?? currentUserId.value;
                                  }
                                }}
                                class="accent-indigo-400"
                              />
                            </td>
                            {users.value.length > 2 && (
                              <td class="px-4 py-3 text-right">
                                {user.id !== currentUserId.value &&
                                  (() => {
                                    const bd = props.balanceEntries.value
                                      .find(
                                        (b) => b.userId === user.id,
                                      );
                                    if (
                                      !bd || Math.abs(bd.amount) < 0.01
                                    ) {
                                      return null;
                                    }
                                    return bd.amount > 0
                                      ? (
                                        <span class="text-xs font-semibold text-green-400">
                                          {t("modal.owes_you", {
                                            amount: formatMoney(bd.amount),
                                          })}
                                        </span>
                                      )
                                      : (
                                        <span class="text-xs font-semibold text-red-400">
                                          {t("modal.you_owe_them", {
                                            amount: formatMoney(
                                              Math.abs(bd.amount),
                                            ),
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

                  <div class="md:hidden divide-y divide-border-custom">
                    {users.value.map((user) => {
                      const userInitials = initials(user.name);
                      const bd = users.value.length > 2 &&
                          user.id !== currentUserId.value
                        ? props.balanceEntries.value.find((b) =>
                          b.userId === user.id
                        )
                        : null;
                      return (
                        <div
                          key={user.id}
                          class="flex items-center gap-3 px-3 py-3"
                        >
                          <div class="flex flex-col items-center gap-1">
                            <span class="text-[9px] text-zinc-500 uppercase">
                              {t("modal.paid_header")}
                            </span>
                            <input
                              type="radio"
                              name="pagoPaidMobile"
                              value={user.id}
                              checked={userPaid.value === user.id}
                              onChange={() => {
                                userPaid.value = user.id;
                                if (paymentRecipient.value === user.id) {
                                  paymentRecipient.value =
                                    users.value.find((u) => u.id !== user.id)
                                      ?.id ?? "";
                                }
                              }}
                              class="accent-primary"
                            />
                          </div>
                          <div class="flex flex-col items-center gap-1">
                            <span class="text-[9px] text-zinc-500 uppercase">
                              {t("modal.received_header")}
                            </span>
                            <input
                              type="radio"
                              name="pagoRecipientMobile"
                              value={user.id}
                              checked={paymentRecipient.value === user.id}
                              onChange={() => {
                                paymentRecipient.value = user.id;
                                if (userPaid.value === user.id) {
                                  userPaid.value = users.value.find((u) =>
                                    u.id !== user.id
                                  )?.id ?? currentUserId.value;
                                }
                              }}
                              class="accent-indigo-400"
                            />
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <div
                                class="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                                style={`background-color: ${user.color}30; color: ${user.color}`}
                              >
                                {userInitials}
                              </div>
                              <span class="text-sm font-medium text-white truncate">
                                {user.name}
                                {user.id === currentUserId.value && (
                                  <span class="text-zinc-500 ml-1">
                                    {t("common.you_label")}
                                  </span>
                                )}
                                {props.entityIds.value.has(user.id) && (
                                  <span class="text-xs ml-1 px-1 py-0.5 rounded bg-white/10 text-zinc-400">
                                    {t("common.tercero_badge")}
                                  </span>
                                )}
                              </span>
                            </div>
                            {bd && Math.abs(bd.amount) >= 0.01 && (
                              <span
                                class={`text-xs font-semibold ${
                                  bd.amount > 0
                                    ? "text-green-400"
                                    : "text-red-400"
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

              <section class="space-y-3">
                <label class="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={linkToTransaction.value}
                    disabled={!hasEligibleTransactions.value ||
                      amount.value === 0}
                    onChange={() => {
                      linkToTransaction.value = !linkToTransaction.value;
                      if (!linkToTransaction.value) {
                        selectedRelatedTxId.value = null;
                        selectedExpenseIds.value = [];
                      }
                    }}
                    class="accent-primary w-4 h-4"
                  />
                  <span class="text-sm font-medium text-zinc-300">
                    {t("modal.link_expenses")}
                  </span>
                  {!hasEligibleTransactions.value && (
                    <span class="relative group">
                      <span class="inline-flex items-center justify-center w-4 h-4 text-xs font-bold rounded-full bg-white/10 text-zinc-400 cursor-help">
                        ?
                      </span>
                      <span class="absolute left-5 top-1/2 -translate-y-1/2 w-64 bg-surface border border-white/10 text-white text-xs font-normal no-underline rounded-custom px-3 py-2 shadow-xl z-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        {t("modal.link_expenses_tooltip")}
                      </span>
                    </span>
                  )}
                </label>

                {linkToTransaction.value &&
                  hasEligibleTransactions.value && (
                  <div class="space-y-2">
                    <div class="relative">
                      <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
                        <svg
                          class="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                          />
                        </svg>
                      </span>
                      <input
                        type="text"
                        placeholder={t("modal.search_expense")}
                        value={relatedTxSearch.value}
                        onInput={(e) =>
                          relatedTxSearch.value =
                            (e.target as HTMLInputElement).value}
                        class="w-full bg-background border-white/20 rounded-custom pl-9 pr-8 text-white text-sm placeholder-zinc-500 focus:ring-primary focus:border-primary py-2"
                      />
                      {relatedTxSearch.value && (
                        <button
                          type="button"
                          onClick={() => relatedTxSearch.value = ""}
                          class="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-white"
                        >
                          <svg
                            class="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M6 18L18 6M6 6l12 12"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                        </button>
                      )}
                    </div>

                    <div class="max-h-60 overflow-y-auto custom-scrollbar space-y-1.5 border border-white/5 rounded-custom p-2 bg-background">
                      {filteredEligible.value.length === 0
                        ? (
                          <p class="text-xs text-zinc-400 text-center py-4">
                            {t("modal.no_expenses_found")}
                          </p>
                        )
                        : filteredEligible.value.map((etx) => {
                          const isSelected = selectedExpenseIds.value
                            .includes(etx.id);
                          const paidByName = etx.paidByUser;
                          const maxAmount = etx.remainingDebt;
                          return (
                            <button
                              key={etx.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  selectedExpenseIds.value = selectedExpenseIds
                                    .value.filter(
                                      (id) => id !== etx.id,
                                    );
                                } else {
                                  selectedExpenseIds.value = [
                                    ...selectedExpenseIds.value,
                                    etx.id,
                                  ];
                                  paymentRecipient.value = etx.userPaid;
                                }
                                enforceSelectionConstraint();
                              }}
                              class={`w-full text-left p-3 rounded-custom transition-all ${
                                isSelected
                                  ? "bg-emerald-900/30 border border-emerald-700/40"
                                  : "bg-white/5 border border-white/5 hover:bg-white/5"
                              }`}
                            >
                              <div class="flex justify-between items-start gap-2">
                                <div class="min-w-0 flex-1">
                                  <p
                                    class={`text-sm font-medium truncate ${
                                      isSelected
                                        ? "text-emerald-300"
                                        : "text-white"
                                    }`}
                                  >
                                    {etx.description}
                                  </p>
                                  <p class="text-xs text-zinc-400 mt-0.5">
                                    {t("modal.paid_by_name", {
                                      name: paidByName,
                                    })} &bull; {formatDate(
                                      etx.createdAt,
                                      props.locale ??
                                        "es",
                                      {
                                        month: "short",
                                        day: "numeric",
                                      },
                                    )}
                                  </p>
                                </div>
                                <div class="text-right shrink-0">
                                  <p class="text-sm font-bold text-red-400">
                                    -${formatMoney(maxAmount)}
                                  </p>
                                  {Math.abs(
                                        etx.remainingDebt -
                                          etx.originalDebt,
                                      ) > 0.01 && (
                                    <p class="text-[10px] text-zinc-400">
                                      {t("tx.of_total", {
                                        total: formatMoney(etx.originalDebt),
                                      })}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                    </div>

                    {selectedExpenseIds.value.length > 0 && (
                      <div class="space-y-2">
                        {(() => {
                          const alloc = computeAllocation(
                            Math.abs(amount.value),
                            selectedExpenseIds.value,
                          );
                          const totalAllocated = alloc.reduce(
                            (s, a) => s + a.amount,
                            0,
                          );
                          const remainder = Math.abs(amount.value) -
                            totalAllocated;
                          return (
                            <div class="border border-white/10 rounded-custom p-3 bg-white/5 space-y-2">
                              <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                                Distribución
                              </p>
                              {alloc.map((a, idx) => {
                                const exp = eligibleTransactions.value
                                  .find((e) => e.id === a.expenseId);
                                const coverage = exp
                                  ? Math.min(1, a.amount / exp.remainingDebt)
                                  : 1;
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
                                    class={`flex flex-col gap-1${
                                      idx > 0
                                        ? " pt-2 border-t border-white/5"
                                        : ""
                                    }`}
                                  >
                                    <div class="flex justify-between items-center text-xs">
                                      <span class="text-slate-300 truncate">
                                        {exp?.description ??
                                          t("modal.allocation_expense")}
                                      </span>
                                      <span class="text-white font-semibold ml-2">
                                        ${formatMoney(a.amount)}
                                      </span>
                                    </div>
                                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                      <div
                                        class={`h-full ${barColor} rounded-full transition-all`}
                                        style={`width: ${barWidth}%`}
                                      />
                                    </div>
                                    <div class="flex justify-between items-center text-[10px] text-zinc-400">
                                      <span>
                                        {isFull
                                          ? t(
                                            "modal.allocation_fully_covered",
                                          )
                                          : t("modal.allocation_partial", {
                                            covered: formatMoney(a.amount),
                                            total: formatMoney(
                                              exp!.remainingDebt,
                                            ),
                                          })}
                                      </span>
                                      {!isFull && (
                                        <span
                                          class={`${
                                            coverage >= 0.5
                                              ? "text-amber-400"
                                              : "text-red-400"
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
                                <div class="flex justify-between items-center text-xs border-t border-white/5 pt-1.5">
                                  <span class="text-zinc-400">
                                    {t("modal.allocation_unassigned")}
                                  </span>
                                  <span class="text-amber-400 font-semibold">
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
          )
          : (
            <section class="space-y-3 sm:space-y-4">
              <div class="flex justify-between items-center">
                <h3 class="text-sm font-bold uppercase tracking-wider text-zinc-400">
                  {t("modal.split_section")}
                </h3>
                <div class="flex gap-2" data-tour="split-mode">
                  <button
                    type="button"
                    onClick={setAutoSplit}
                    class={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                      splitMode.value === "auto"
                        ? "bg-primary text-white shadow-sm"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {t("modal.split_auto")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (defaultSplit.value) {
                        splitMode.value = "percentage";
                        percentages.value = buildDefaultPercentages();
                      } else {
                        splitMode.value = "percentage";
                      }
                    }}
                    class={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                      splitMode.value === "percentage"
                        ? "bg-primary text-white shadow-sm"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {t("modal.split_percentage")}
                  </button>
                  <button
                    type="button"
                    onClick={() => splitMode.value = "fixed"}
                    class={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${
                      splitMode.value === "fixed"
                        ? "bg-primary text-white shadow-sm"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {t("modal.split_fixed")}
                  </button>
                </div>
              </div>

              <div class="border border-white/10 rounded-custom overflow-hidden">
                <table class="hidden md:table w-full text-left border-collapse">
                  <thead class="bg-white/5">
                    <tr>
                      <th class="px-4 py-3 text-xs font-semibold text-zinc-400">
                        {t("modal.user_header")}
                      </th>
                      <th class="px-4 py-3 text-xs font-semibold text-zinc-400 w-32 text-right">
                        %
                      </th>
                      <th class="px-4 py-3 text-xs font-semibold text-zinc-400 w-40 text-right">
                        {t("modal.amount_header")}
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border-custom">
                    {users.value.map((user) => {
                      const split = splits.value.find((s) =>
                        s.userId === user.id
                      );
                      const userInitials = initials(user.name);
                      return (
                        <tr key={user.id}>
                          <td class="px-4 py-3">
                            <div class="flex items-center gap-3">
                              <div
                                class="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={`background-color: ${user.color}30; color: ${user.color}`}
                              >
                                {userInitials}
                              </div>
                              <span class="text-sm font-medium text-white">
                                {user.name}
                                {user.id === currentUserId.value && (
                                  <span class="text-zinc-500 ml-1">
                                    {t("common.you_label")}
                                  </span>
                                )}
                                {props.entityIds.value.has(user.id) && (
                                  <span class="text-xs ml-1 px-1.5 py-0.5 rounded bg-white/10 text-zinc-400">
                                    {t("common.tercero_badge")}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td class="px-4 py-3">
                            <div class="flex items-center justify-end">
                              {splitMode.value === "percentage"
                                ? (
                                  <input
                                    class="w-20 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                    type="text"
                                    inputmode="decimal"
                                    value={percentages.value[user.id] ??
                                      0}
                                    onInput={(e) => {
                                      const sanitized = sanitizeDecimal(
                                        (e.target as HTMLInputElement)
                                          .value,
                                      );
                                      (e.target as HTMLInputElement)
                                        .value = sanitized;
                                      updatePercentage(
                                        user.id,
                                        sanitized,
                                      );
                                    }}
                                  />
                                )
                                : (
                                  <span class="text-sm text-zinc-400">
                                    {split?.percentage.toFixed(0) ?? 0}
                                  </span>
                                )}
                              <span class="ml-1 text-zinc-500">%</span>
                            </div>
                          </td>
                          <td class="px-4 py-3">
                            <div class="flex items-center justify-end">
                              {splitMode.value === "fixed"
                                ? (
                                  <input
                                    class="w-28 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                    type="text"
                                    inputmode="decimal"
                                    value={fixedAmounts.value[user.id] ??
                                      0}
                                    onInput={(e) => {
                                      const sanitized = sanitizeDecimal(
                                        (e.target as HTMLInputElement)
                                          .value,
                                      );
                                      (e.target as HTMLInputElement)
                                        .value = sanitized;
                                      updateFixedAmount(
                                        user.id,
                                        sanitized,
                                      );
                                    }}
                                  />
                                )
                                : (
                                  <span class="text-sm text-white">
                                    {split?.amount.toFixed(2) ?? "0.00"}
                                  </span>
                                )}
                              {splitMode.value === "fixed" && (
                                <span class="ml-1 text-zinc-500">$</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot class="bg-white/5">
                    <tr>
                      <td class="px-4 py-2 text-xs font-bold text-zinc-400 italic">
                        {t("modal.total_header")}
                      </td>
                      <td
                        class={`px-4 py-2 text-right text-xs font-bold ${
                          Math.abs(totalPct - 100) < 0.01
                            ? "text-white"
                            : "text-red-400"
                        }`}
                      >
                        {totalPct.toFixed(0)}%
                      </td>
                      <td
                        class={`px-4 py-2 text-right text-xs font-bold ${
                          Math.abs(
                              totalSplitAmount - Math.abs(amount.value),
                            ) < 0.01
                            ? "text-white"
                            : "text-red-400"
                        }`}
                      >
                        ${totalSplitAmount.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                <div class="md:hidden divide-y divide-border-custom">
                  {users.value.map((user) => {
                    const split = splits.value.find((s) =>
                      s.userId === user.id
                    );
                    const userInitials = initials(user.name);
                    return (
                      <div
                        key={user.id}
                        class="flex items-start gap-3 px-3 py-3"
                      >
                        <div class="flex-1 min-w-0 space-y-1.5">
                          <div class="flex items-center gap-2">
                            <div
                              class="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                              style={`background-color: ${user.color}30; color: ${user.color}`}
                            >
                              {userInitials}
                            </div>
                            <span class="text-sm font-medium text-white truncate">
                              {user.name}
                              {user.id === currentUserId.value && (
                                <span class="text-zinc-500 ml-1">
                                  {t("common.you_label")}
                                </span>
                              )}
                              {props.entityIds.value.has(user.id) && (
                                <span class="text-xs ml-1 px-1 py-0.5 rounded bg-white/10 text-zinc-400">
                                  {t("common.tercero_badge")}
                                </span>
                              )}
                            </span>
                          </div>
                          <div class="flex items-center gap-4 text-sm">
                            <div class="flex items-center">
                              {splitMode.value === "percentage"
                                ? (
                                  <input
                                    class="w-16 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                    type="text"
                                    inputmode="decimal"
                                    value={percentages.value[user.id] ??
                                      0}
                                    onInput={(e) => {
                                      const sanitized = sanitizeDecimal(
                                        (e.target as HTMLInputElement)
                                          .value,
                                      );
                                      (e.target as HTMLInputElement)
                                        .value = sanitized;
                                      updatePercentage(
                                        user.id,
                                        sanitized,
                                      );
                                    }}
                                  />
                                )
                                : (
                                  <span class="text-zinc-400">
                                    {split?.percentage.toFixed(0) ?? 0}
                                  </span>
                                )}
                              <span class="ml-0.5 text-zinc-500 text-xs">
                                %
                              </span>
                            </div>
                            <div class="flex items-center">
                              {splitMode.value === "fixed"
                                ? (
                                  <input
                                    class="w-24 px-2 py-1 bg-background border border-white/20 rounded text-right text-sm font-medium text-white focus:ring-primary focus:border-primary"
                                    type="text"
                                    inputmode="decimal"
                                    value={fixedAmounts.value[user.id] ??
                                      0}
                                    onInput={(e) => {
                                      const sanitized = sanitizeDecimal(
                                        (e.target as HTMLInputElement)
                                          .value,
                                      );
                                      (e.target as HTMLInputElement)
                                        .value = sanitized;
                                      updateFixedAmount(
                                        user.id,
                                        sanitized,
                                      );
                                    }}
                                  />
                                )
                                : (
                                  <span class="text-white">
                                    ${(split?.amount ?? 0).toFixed(2)}
                                  </span>
                                )}
                              {splitMode.value === "fixed" && (
                                <span class="ml-0.5 text-zinc-500 text-xs">
                                  $
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div class="flex items-center justify-between px-3 py-2 bg-white/5">
                    <span class="text-xs font-bold text-zinc-400 italic">
                      {t("modal.total_header")}
                    </span>
                    <div class="flex items-center gap-4">
                      <span
                        class={`text-xs font-bold ${
                          Math.abs(totalPct - 100) < 0.01
                            ? "text-white"
                            : "text-red-400"
                        }`}
                      >
                        {totalPct.toFixed(0)}%
                      </span>
                      <span
                        class={`text-xs font-bold ${
                          Math.abs(
                              totalSplitAmount - Math.abs(amount.value),
                            ) < 0.01
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
