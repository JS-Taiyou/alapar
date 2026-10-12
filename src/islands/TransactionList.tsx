import { type Signal, useComputed, useSignal, useSignalEffect } from "@preact/signals";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  SpawnCandidate,
  TransactionPayment,
} from "../lib/types";
import { type EnrichedTransaction, entitiesChanged, registrySwitch } from "./shared-signals";
import { rowToEnrichedTransaction } from "../lib/rows";
import ProBadge from "./ProBadge";

function dedupById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
import { calculateBalance, calculatePairwiseBreakdown } from "../lib/calculations";
import {
  resubscribe,
  setOnResync,
  setupRealtimeConfig,
  subscribeToRegistry,
  unsubscribeAll,
} from "../lib/realtime";
import { isAuthFailure, redirectToLogin } from "../lib/auth-client";
import { requestNotificationPermission, subscribeToPush } from "../lib/notifications";
import { cache } from "../lib/cache";
import TransactionModal from "./TransactionModal";
import { formatMoney, initials } from "../lib/format";
import { formatDate, formatTime, type Locale, t as translate } from "../lib/i18n";

let lastPushSubscribedRegistry: string | null = null;

interface TransactionListProps {
  transactions: Signal<EnrichedTransaction[]>;
  users: Signal<Participant[]>;
  currentUserId: Signal<string>;
  registryId: Signal<string>;
  balance: Signal<number>;
  balanceEntries: Signal<BalanceBreakdownEntry[]>;
  defaultSplit: Signal<DefaultSplit | null>;
  spawnCandidates: Signal<SpawnCandidate[]>;
  lastModified: Signal<string | null>;
  entityIds: Signal<Set<string>>;
  entities: Signal<{ id: string; name: string; color: string }[]>;
  transactionPayments: Signal<TransactionPayment[]>;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  isDemo?: boolean;
  locale?: Locale;
}

function TransactionCardClickable(props: {
  tx: EnrichedTransaction;
  users: Participant[];
  currentUserId: string;
  onClick: () => void;
  allTxs?: EnrichedTransaction[];
  transactionPayments?: TransactionPayment[];
  locale?: Locale;
}) {
  const { tx, users, currentUserId } = props;
  const tpList = props.transactionPayments ?? [];
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  if (tx.type === "ajuste") {
    const formattedAmount = formatMoney(tx.originalAmount);

    return (
      <div class="w-full text-left bg-card p-5 rounded-custom border-l-4 border-l-amber-500 border border-white/5 flex justify-between items-center">
        <div class="flex flex-col min-w-0">
          <span class="text-lg font-semibold text-white flex items-center gap-2 truncate">
            {tx.description}
            <span class="text-xs font-medium px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 shrink-0">
              {t("tx.badge_adjustment")}
            </span>
          </span>
          <span class="text-sm text-zinc-400">
            {formatDate(tx.createdAt, props.locale ?? "es")} &bull;{" "}
            {formatTime(tx.createdAt, props.locale ?? "es")}
          </span>
        </div>
        <div class="text-right flex flex-col items-end">
          <span class="text-xl font-bold text-amber-400">${formattedAmount}</span>
        </div>
      </div>
    );
  }

  if (tx.type === "pago") {
    const isPayer = tx.userPaid === currentUserId;
    const recipientSplit = tx.splitJson.splits[0];
    const recipientUser = recipientSplit ? users.find((u) => u.id === recipientSplit.userId) : null;
    const payerUser = tx.paidByUser;
    const formattedAmount = formatMoney(tx.originalAmount);

    let label = "";
    if (isPayer && recipientUser) {
      label = t("tx.paid_to", { name: recipientUser.name });
    } else if (!isPayer && payerUser) {
      label = t("tx.received_from", { name: payerUser.name });
    }

    const linkedExpenseIds = tpList.filter((tp) => tp.pagoId === tx.id).map((tp) => tp.expenseId);
    const linkedExpenses =
      linkedExpenseIds.length > 0
        ? (props.allTxs ?? []).filter((t) => linkedExpenseIds.includes(t.id))
        : tx.relatedTransactionId
          ? (props.allTxs ?? []).filter((t) => t.id === tx.relatedTransactionId)
          : [];

    return (
      <div class="w-full">
        <button
          type="button"
          onClick={props.onClick}
          class={`w-full text-left bg-card p-5 border-l-4 border-l-indigo-500 border border-white/5 flex justify-between items-center transition-transform active:scale-[0.98] hover:bg-white/2 ${
            linkedExpenses.length === 0 ? "rounded-custom" : "rounded-t-custom"
          }`}
        >
          <div class="flex flex-col min-w-0">
            <span class="text-lg font-semibold text-white flex items-center gap-2 truncate">
              {tx.description}
              <span class="text-xs font-medium px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">
                {t("tx.badge_payment")}
              </span>
            </span>
            <span class="text-sm text-zinc-400">
              {formatDate(tx.createdAt, props.locale ?? "es")} &bull;{" "}
              {formatTime(tx.createdAt, props.locale ?? "es")}
              {label && (
                <>
                  {" "}
                  &bull; <span class="text-indigo-400">{label}</span>
                </>
              )}
            </span>
          </div>
          <div class="text-right flex flex-col items-end">
            <span class="text-xl font-bold text-indigo-400">${formattedAmount}</span>
          </div>
        </button>
        {linkedExpenses.length > 0 &&
          linkedExpenses.map((relatedTx, idx) => (
            <button
              key={relatedTx.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const el = document.getElementById(`tx-${relatedTx.id}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  setTimeout(() => {
                    el.classList.remove("highlight-pulse");
                    void el.offsetWidth;
                    el.classList.add("highlight-pulse");
                    el.addEventListener(
                      "animationend",
                      () => {
                        el.classList.remove("highlight-pulse");
                      },
                      { once: true },
                    );
                  }, 450);
                }
              }}
              class={`w-full text-left bg-slate-800/60 px-5 py-2.5 border-l-4 border-l-indigo-500/40 border border-t-0 border-white/5 flex items-center gap-3 hover:bg-slate-700/60 transition-colors ${
                idx === linkedExpenses.length - 1 ? "rounded-b-custom" : ""
              }`}
            >
              <svg
                class="w-3.5 h-3.5 text-slate-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
                <path
                  d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium text-zinc-300 truncate">{relatedTx.description}</p>
                <p class="text-[10px] text-zinc-400">
                  {formatDate(relatedTx.createdAt, props.locale ?? "es", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <svg
                class="w-3 h-3 text-slate-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M19 9l-7 7-7-7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </button>
          ))}
      </div>
    );
  }

  const isPaidByMe = tx.userPaid === currentUserId;
  const userSplit = tx.splitJson.splits.find((s) => s.userId === currentUserId);
  const divisor = tx.type === "parcialidad" && tx.installmentTotal ? tx.installmentTotal : 1;
  const perInstallmentTotal = tx.originalAmount / divisor;
  const perInstallmentSplit = (userSplit?.amount ?? 0) / divisor;
  const personalBalance = isPaidByMe
    ? perInstallmentTotal - perInstallmentSplit
    : -perInstallmentSplit;

  const linkedPaymentTps = tpList.filter((tp) => tp.expenseId === tx.id);
  const linkedPaymentIds = new Set(linkedPaymentTps.map((tp) => tp.pagoId));
  const linkedPayments = (props.allTxs ?? []).filter(
    (t) => linkedPaymentIds.has(t.id) || (t.type === "pago" && t.relatedTransactionId === tx.id),
  );

  let paymentsAffectingMe = 0;
  if (!isPaidByMe && personalBalance < 0) {
    paymentsAffectingMe = linkedPaymentTps
      .filter((tp) => {
        const pagoTx = (props.allTxs ?? []).find((t) => t.id === tp.pagoId);
        return pagoTx?.userPaid === currentUserId;
      })
      .reduce((sum, tp) => sum + tp.amount, 0);
    if (paymentsAffectingMe === 0) {
      paymentsAffectingMe = linkedPayments
        .filter((p) => p.userPaid === currentUserId)
        .reduce((sum, p) => sum + p.originalAmount, 0);
    }
  } else if (isPaidByMe && personalBalance > 0) {
    paymentsAffectingMe = linkedPaymentTps
      .filter((tp) => {
        const pagoTx = (props.allTxs ?? []).find((t) => t.id === tp.pagoId);
        return pagoTx?.splitJson?.splits?.[0]?.userId === currentUserId;
      })
      .reduce((sum, tp) => sum + tp.amount, 0);
    if (paymentsAffectingMe === 0) {
      paymentsAffectingMe = linkedPayments
        .filter((p) => p.splitJson.splits[0]?.userId === currentUserId)
        .reduce((sum, p) => sum + p.originalAmount, 0);
    }
  }

  const remainingBalance = isPaidByMe
    ? Math.max(0, personalBalance - paymentsAffectingMe)
    : -Math.max(0, Math.abs(personalBalance) - paymentsAffectingMe);

  const isZero = Math.abs(remainingBalance) < 0.005;
  const isPositive = remainingBalance >= 0;

  return (
    <button
      type="button"
      onClick={props.onClick}
      class="w-full text-left bg-card p-5 rounded-custom border border-white/5 flex justify-between items-center transition-transform active:scale-[0.98] hover:bg-white/2"
    >
      <div class="flex flex-col min-w-0">
        <span class="text-lg font-semibold text-white truncate">{tx.description}</span>
        <div class="text-sm text-zinc-400">
          <span class="block sm:inline">
            {formatDate(tx.createdAt, props.locale ?? "es")} &bull;{" "}
            {formatTime(tx.createdAt, props.locale ?? "es")}
          </span>
          {tx.paidByUser && (
            <>
              <span class="hidden sm:inline">
                {" • "}
                <span
                  class={`text-xs px-1.5 py-0.5 rounded ${
                    isPaidByMe
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-slate-300 text-slate-800 font-bold"
                  }`}
                >
                  {isPaidByMe ? t("tx.paid_by_you") : tx.paidByUser.name}
                </span>
              </span>
              <span
                class={`block sm:hidden text-xs px-1.5 py-0.5 rounded mt-0.5 w-fit ${
                  isPaidByMe
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-slate-300 text-slate-800 font-bold"
                }`}
              >
                {isPaidByMe ? t("tx.paid_by_you") : tx.paidByUser.name}
              </span>
            </>
          )}
          {tx.type === "parcialidad" && tx.installmentCurrent && tx.installmentTotal && (
            <>
              {" • "}
              <span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400">
                {t("tx.badge_installment", {
                  current: tx.installmentCurrent,
                  total: tx.installmentTotal,
                })}
              </span>
            </>
          )}
        </div>
      </div>
      <div class="text-right flex flex-col items-end">
        <span
          class={`text-xl font-bold ${
            isZero ? "text-green-500" : isPositive ? "text-green-500" : "text-red-500"
          }`}
        >
          {isZero ? "" : isPositive ? "+" : "-"}${formatMoney(Math.abs(remainingBalance))}
        </span>
        <span class="text-xs text-zinc-400">
          {t("tx.of_total", {
            total: formatMoney(perInstallmentTotal),
          })}
        </span>
      </div>
    </button>
  );
}

export default function TransactionList(props: TransactionListProps) {
  const transactions = props.transactions;
  const users = props.users;
  const currentUserId = props.currentUserId;
  const registryId = props.registryId;
  const defaultSplit = props.defaultSplit;
  const balance = props.balance;
  const balanceEntries = props.balanceEntries;
  const showTerceroPopover = useSignal(false);
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const isOpen = useSignal(false);
  const editingId = useSignal<string | null>(null);
  const modalMode = useSignal<"expense" | "payment">("expense");
  const searchQuery = useSignal("");
  const filterUserId = useSignal<string | null>(null);
  const transactionPayments = props.transactionPayments;

  useSignalEffect(() => {
    const rid = registryId.value;
    if (!rid || !props.supabaseUrl || !props.supabaseAnonKey) return;

    setupRealtimeConfig(props.supabaseUrl, props.supabaseAnonKey);

    let lastNotificationAt = 0;
    const NOTIFICATION_COOLDOWN = 15_000;

    // Events dropped while the channel was dead are backfilled by a
    // stamp-gated fetch every time the channel (re)establishes.
    setOnResync(() => void syncRegistry());

    subscribeToRegistry(rid, (payload) => {
      const participantMap = new Map(users.value.map((u) => [u.id, u]));

      const mapRow = (row: Record<string, unknown>): EnrichedTransaction =>
        rowToEnrichedTransaction(row, participantMap);

      if (payload.eventType === "INSERT" && payload.new?.id) {
        const existing = transactions.value.find((t) => t.id === payload.new.id);
        if (!existing) {
          const creator = payload.new.creator_id as string;
          const desc = payload.new.description as string;
          const amt =
            typeof payload.new.amount === "string"
              ? parseFloat(payload.new.amount)
              : (payload.new.amount as number);
          const type = payload.new.type as string;

          if (creator === currentUserId.value) {
            const optimisticIndex = transactions.value.findIndex(
              (t) =>
                t.creatorId === creator &&
                t.description === desc &&
                t.amount === amt &&
                t.type === type &&
                t.id !== payload.new.id,
            );
            if (optimisticIndex !== -1) {
              const updated = [...transactions.value];
              updated[optimisticIndex] = mapRow(payload.new);
              transactions.value = updated;
            } else {
              transactions.value = [mapRow(payload.new), ...transactions.value];
            }
          } else {
            transactions.value = [mapRow(payload.new), ...transactions.value];
          }
          if (creator !== currentUserId.value) {
            const now = Date.now();
            if (
              now - lastNotificationAt >= NOTIFICATION_COOLDOWN &&
              Notification.permission === "granted"
            ) {
              lastNotificationAt = now;
              const desc = (payload.new.description as string) ?? t("tx.notification_body");
              const amt = typeof payload.new.amount === "number" ? payload.new.amount : 0;
              new Notification(t("tx.notification_title"), {
                body: `${desc} — $${formatMoney(amt)}`,
                icon: "/logo.svg",
              });
            }
          }
        }
      } else if (payload.eventType === "DELETE" && payload.old?.id) {
        transactions.value = transactions.value.filter((t) => t.id !== payload.old.id);
      } else if (payload.eventType === "UPDATE" && payload.new?.id) {
        transactions.value = transactions.value.map((t) =>
          t.id === payload.new.id ? mapRow(payload.new) : t,
        );
      }
      const allParticipants = dedupById([
        ...users.value.map((u) => ({
          id: u.id,
          name: u.name,
          color: u.color,
        })),
        ...props.entities.value.map((e) => ({
          id: e.id,
          name: e.name,
          color: e.color,
        })),
      ]);
      balance.value = calculateBalance(
        transactions.value as Parameters<typeof calculateBalance>[0],
        currentUserId.value,
      );
      balanceEntries.value = calculatePairwiseBreakdown(
        transactions.value as Parameters<typeof calculatePairwiseBreakdown>[0],
        currentUserId.value,
        allParticipants,
      );
    });

    requestNotificationPermission().then((granted) => {
      if (granted && rid !== lastPushSubscribedRegistry) {
        lastPushSubscribedRegistry = rid;
        subscribeToPush(rid);
      }
    });

    return () => {
      setOnResync(null);
      unsubscribeAll();
    };
  });

  useSignalEffect(() => {
    const rid = registryId.value;
    const txs = transactions.value;
    const bal = balance.value;
    const be = balanceEntries.value;
    const usrs = users.value;
    const uid = currentUserId.value;
    const ds = defaultSplit.value;
    const sc = props.spawnCandidates.value;
    const lm = props.lastModified.value;
    const eids = [...props.entityIds.value];
    const ents = props.entities.value;
    const tps = transactionPayments.value;
    if (!rid || (txs.length === 0 && lm === null)) return;
    if (props.isDemo) return;
    cache.setRegistrySnapshot({
      registryId: rid,
      transactions: txs.map((t) => ({
        ...t,
        createdAt: typeof t.createdAt === "string" ? t.createdAt : t.createdAt.toISOString(),
      })),
      transactionPayments: tps,
      balance: bal,
      balanceEntries: be,
      users: usrs,
      currentUserId: uid,
      defaultSplit: ds,
      spawnCandidates: sc,
      entityIds: eids,
      entities: ents,
      lastModified: lm,
    });
  });

  useSignalEffect(() => {
    const payload = registrySwitch.value;
    if (!payload) return;
    registryId.value = payload.registryId;
    if (payload.transactions) {
      transactions.value = payload.transactions.map((t) => ({
        ...t,
        createdAt:
          typeof (t as unknown as { createdAt: unknown }).createdAt === "string"
            ? new Date((t as unknown as { createdAt: string }).createdAt)
            : t.createdAt,
      })) as EnrichedTransaction[];
    }
    if (payload.balance !== undefined) balance.value = payload.balance;
    if (payload.balanceEntries) balanceEntries.value = payload.balanceEntries;
    if (payload.users) users.value = payload.users;
    if (payload.currentUserId) currentUserId.value = payload.currentUserId;
    if (payload.defaultSplit !== undefined) {
      defaultSplit.value = payload.defaultSplit;
    }
    if (payload.spawnCandidates !== undefined) {
      props.spawnCandidates.value = payload.spawnCandidates;
    }
    if (payload.lastModified !== undefined) {
      props.lastModified.value = payload.lastModified;
    }
    if (payload.entityIds) {
      props.entityIds.value = new Set(payload.entityIds);
    }
    if (payload.entities) {
      props.entities.value = payload.entities;
    }
    if (payload.transactionPayments) {
      transactionPayments.value = payload.transactionPayments;
    }
  });

  useSignalEffect(() => {
    const announcement = entitiesChanged.value;
    if (!announcement) return;
    if (announcement.entities) {
      props.entityIds.value = new Set(announcement.entities.map((ent) => ent.id));
      return;
    }
    const rid = registryId.value;
    if (!rid) return;
    if (props.isDemo) return;
    fetch(`/api/entities?registryId=${rid}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ id: string }[]>) : null))
      .then((data) => {
        if (!data) return;
        if (rid !== registryId.value) return;
        props.entityIds.value = new Set(data.map((ent) => ent.id));
      })
      .catch(() => {
        // ignore
      });
  });

  /**
   * Stamp-gated catch-up: compare the server's `last_modified` against the
   * cached snapshot and refetch the full registry only when it moved.
   *
   * Used by three callers that can each discover missed changes: the realtime
   * channel reaching SUBSCRIBED (events dropped while it was dead), the
   * wake-up path (visibility/heartbeat), and — via the same wake-up — the
   * `online` reconnect. An in-flight guard keeps concurrent triggers from
   * racing two fetches and double-applying snapshots.
   *
   * The reconnect moment races the network actually coming up (a laptop's
   * visibilitychange fires before Wi-Fi reconnects), so transient failures
   * retry with backoff instead of leaving the UI silently stale until the
   * next visibility flip. All fetches bypass the HTTP cache: a stored
   * `no-cache` + ETag response can revalidate into a 304, whose empty body
   * would read as failure and mask fresh data.
   */
  const SYNC_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
  let syncInFlight = false;
  async function syncRegistry(): Promise<void> {
    if (props.isDemo) return;
    const rid = registryId.value;
    if (!rid) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      for (let attempt = 0; ; attempt++) {
        if (rid !== registryId.value) return;
        const outcome = await trySyncOnce(rid);
        if (outcome === "done") return;
        if (attempt >= SYNC_RETRY_DELAYS_MS.length) {
          console.warn("[sync] catch-up failed after retries; waiting for next wake signal");
          return;
        }
        await new Promise((r) => setTimeout(r, SYNC_RETRY_DELAYS_MS[attempt]));
      }
    } finally {
      syncInFlight = false;
    }
  }

  /** One catch-up attempt. "retry" = transient failure worth another try. */
  async function trySyncOnce(rid: string): Promise<"done" | "retry"> {
    try {
      const stampRes = await fetch(`/api/stamp/${rid}`, {
        method: "POST",
        cache: "no-store",
      });
      if (rid !== registryId.value) return "done";
      // Dead session (expired refresh token): go to login instead of
      // silently leaving the screen frozen on stale data.
      if (isAuthFailure(stampRes)) {
        redirectToLogin();
        return "done";
      }
      if (!stampRes.ok) return "retry";
      const { lastModified } = (await stampRes.json()) as {
        lastModified: string | null;
      };
      const cached = await cache.getRegistrySnapshot(rid);
      if (rid !== registryId.value) return "done";
      // Null stamp = version unknown → always refetch, never "in sync".
      if (lastModified && cached?.lastModified === lastModified) return "done";

      const dashRes = await fetch(`/api/dashboard?registryId=${rid}`, {
        cache: "no-store",
      });
      if (rid !== registryId.value) return "done";
      if (isAuthFailure(dashRes)) {
        redirectToLogin();
        return "done";
      }
      if (!dashRes.ok) return "retry";
      const data = (await dashRes.json()) as {
        transactions: unknown[];
        transactionPayments: TransactionPayment[];
        balance: number;
        balanceEntries: BalanceBreakdownEntry[];
        users: Participant[];
        defaultSplit: DefaultSplit | null;
        spawnCandidates: SpawnCandidate[];
        entityIds: string[];
        entities: { id: string; name: string; color: string }[];
      };

      transactions.value = (data.transactions as EnrichedTransaction[]).map((t) => ({
        ...t,
        createdAt:
          typeof (t as unknown as { createdAt: unknown }).createdAt === "string"
            ? new Date((t as unknown as { createdAt: string }).createdAt)
            : t.createdAt,
      }));
      balance.value = data.balance;
      balanceEntries.value = data.balanceEntries;
      if (data.defaultSplit !== undefined) {
        defaultSplit.value = data.defaultSplit;
      }
      if (data.spawnCandidates) {
        props.spawnCandidates.value = data.spawnCandidates;
      }
      if (data.users) {
        users.value = data.users;
      }
      if (data.entityIds) {
        props.entityIds.value = new Set(data.entityIds);
      }
      if (data.entities) {
        props.entities.value = data.entities;
      }
      if (data.transactionPayments) {
        transactionPayments.value = data.transactionPayments;
      }
      props.lastModified.value = lastModified;
      return "done";
    } catch {
      // Network-level failure (offline, DNS not ready after resume).
      return "retry";
    }
  }

  useSignalEffect(() => {
    let lastActive = Date.now();
    const FRESHNESS_MS = 30_000;
    const HEARTBEAT_MS = 10_000;

    function wentToSleep() {
      lastActive = Date.now();
    }

    async function wokeUp() {
      if (props.isDemo) return;
      const rid = registryId.value;
      if (!rid) return;
      const elapsed = Date.now() - lastActive;
      if (elapsed < FRESHNESS_MS) return;

      resubscribe().catch(() => {});
      await syncRegistry();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") wentToSleep();
      else wokeUp();
    }

    function onOnline() {
      // The wake-up sync may have fired before the network was actually up
      // (visibilitychange wins that race) and exhausted its retries — try
      // again now that the browser reports connectivity.
      lastActive = 0;
      wokeUp();
    }

    document.addEventListener("visibilitychange", onVisibility);
    globalThis.addEventListener("online", onOnline);
    globalThis.addEventListener("pageshow", wokeUp);

    let lastTick = Date.now();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;
      if (gap > HEARTBEAT_MS + FRESHNESS_MS) {
        lastActive = 0;
        wokeUp();
      }
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      globalThis.removeEventListener("online", onOnline);
      globalThis.removeEventListener("pageshow", wokeUp);
    };
  });

  const filteredTransactions = useComputed(() => {
    let list = transactions.value;
    if (filterUserId.value) {
      list = list.filter((tx) => tx.userPaid === filterUserId.value);
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      // Amount search: digits-only view of the query (strips $, commas,
      // decimals) matched against the CENTS representation of the amounts
      // shown on the card — so "1613", "$1,613" and "1,613.00" all find a
      // $1,613 transaction (161300 cents contains every prefix of those).
      const digits = q.replace(/[^0-9]/g, "");
      const centsContains = (n: number) => String(Math.round(n * 100)).includes(digits);
      list = list.filter(
        (tx) =>
          tx.description.toLowerCase().includes(q) ||
          (digits.length > 0 && (centsContains(tx.originalAmount) || centsContains(tx.amount))),
      );
    }
    return [...list].sort((a, b) => {
      const da = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const db = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      if (db !== da) return db - da;
      return a.description.localeCompare(b.description);
    });
  });

  if (users.value.length <= 1) {
    return (
      <main class="flex-1 overflow-y-auto custom-scrollbar p-6 flex items-center justify-center">
        <div class="text-center max-w-sm space-y-6">
          <div class="bg-white/5 p-6 rounded-full mx-auto w-fit">
            <svg
              class="h-16 w-16 text-zinc-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
              />
            </svg>
          </div>
          <h3 class="text-2xl font-bold text-white">{t("tx.single_user_title")}</h3>
          <p class="text-zinc-400 text-base leading-relaxed">
            {t("tx.single_user_desc")}{" "}
            <span
              class="font-bold underline cursor-pointer text-orange-400 relative"
              onClick={() => (showTerceroPopover.value = !showTerceroPopover.value)}
              onMouseEnter={() => (showTerceroPopover.value = true)}
              onMouseLeave={() => (showTerceroPopover.value = false)}
            >
              tercero
              {showTerceroPopover.value && (
                <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-surface border border-white/10 text-white text-xs font-normal no-underline rounded-custom px-3 py-2 shadow-xl z-50">
                  {t("tx.tercero_tooltip")}
                </span>
              )}
            </span>
          </p>
        </div>
      </main>
    );
  }

  function recalculate() {
    const allParticipants = dedupById([
      ...users.value.map((u) => ({
        id: u.id,
        name: u.name,
        color: u.color,
      })),
      ...props.entities.value.map((e) => ({
        id: e.id,
        name: e.name,
        color: e.color,
      })),
    ]);
    balance.value = calculateBalance(transactions.value, currentUserId.value);
    balanceEntries.value = calculatePairwiseBreakdown(
      transactions.value,
      currentUserId.value,
      allParticipants,
    );
  }

  function openNew() {
    modalMode.value = "expense";
    editingId.value = null;
    isOpen.value = true;
  }

  function openNewPago() {
    modalMode.value = "payment";
    editingId.value = null;
    isOpen.value = true;
  }

  function openEdit(tx: EnrichedTransaction) {
    editingId.value = tx.id;
    modalMode.value = tx.type === "pago" ? "payment" : "expense";
    isOpen.value = true;
  }

  return (
    <>
      <main
        class="flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-6 space-y-4 relative"
        data-tour="transaction-list"
      >
        <div class="flex justify-between items-center mb-2">
          <h2 class="text-lg font-semibold text-zinc-200">
            {filterUserId.value
              ? t("tx.current_period_filtered", {
                  name: users.value.find((u) => u.id === filterUserId.value)?.name ?? "",
                })
              : t("tx.current_period")}
          </h2>
        </div>

        {transactions.value.length > 1 && (
          <div class="space-y-3">
            {new Set(transactions.value.map((tx) => tx.userPaid)).size > 1 && (
              <div class="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => (filterUserId.value = null)}
                  class={`text-xs font-semibold px-3 py-1.5 rounded transition-colors cursor-pointer ${
                    filterUserId.value === null
                      ? "bg-primary text-white shadow-sm"
                      : "text-zinc-400 hover:text-white hover:bg-white/5 border border-white/10"
                  }`}
                >
                  {t("tx.all")}
                </button>
                {users.value.map((user) => {
                  const userInitials = initials(user.name);
                  // Active state: colored BORDER + white name, NOT a solid
                  // fill — filling with user.color made the initials avatar
                  // (same color on same color) invisible.
                  const active = filterUserId.value === user.id;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => {
                        filterUserId.value = active ? null : user.id;
                      }}
                      class={`text-xs font-semibold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 cursor-pointer border ${
                        active
                          ? "text-white shadow-sm"
                          : "text-zinc-400 hover:text-white hover:bg-white/5 border-white/10"
                      }`}
                      style={active ? `border-color: ${user.color}` : ""}
                    >
                      <div
                        class="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                        style={`background-color: ${user.color}30; color: ${user.color}`}
                      >
                        {userInitials}
                      </div>
                      {user.name.split(" ")[0]}
                      <ProBadge pro={user.pro ?? null} locale={props.locale} linked={false} />
                    </button>
                  );
                })}
              </div>
            )}
            <div class="relative">
              <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                data-tour="search-bar"
                placeholder={t("tx.search_placeholder")}
                value={searchQuery.value}
                onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
                class="w-full bg-white/5 border border-white/15 rounded-custom pl-10 text-white placeholder-zinc-500 focus:ring-primary focus:border-primary py-2.5"
              />
              {searchQuery.value && (
                <button
                  type="button"
                  onClick={() => (searchQuery.value = "")}
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-white"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          </div>
        )}

        <div class="sm:hidden flex gap-2">
          <button
            type="button"
            onClick={openNewPago}
            data-tour="add-payment-mobile"
            class="flex-1 py-3 bg-green-700 hover:bg-green-800 text-white font-bold text-base rounded-custom active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            {t("tx.add_payment_mobile")}
          </button>
          <button
            type="button"
            onClick={openNew}
            data-tour="add-expense-mobile"
            class="flex-1 py-3 bg-yellow-500 hover:bg-yellow-600 text-white font-bold text-base rounded-custom active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            {t("tx.add_expense_mobile")}
          </button>
        </div>

        {transactions.value.length === 0 ? (
          <div class="flex flex-col items-center justify-center py-20 text-center">
            <div class="bg-white/5 p-4 rounded-full mb-4">
              <svg
                class="h-12 w-12 text-zinc-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </div>
            <h3 class="text-lg font-medium text-zinc-300">{t("tx.empty_title")}</h3>
            <p class="text-zinc-400 mt-2">{t("tx.empty_desc")}</p>
          </div>
        ) : filteredTransactions.value.length === 0 ? (
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <p class="text-zinc-400">{t("tx.no_results")}</p>
            <button
              type="button"
              onClick={() => {
                searchQuery.value = "";
                filterUserId.value = null;
              }}
              class="mt-2 text-sm text-primary hover:underline"
            >
              {t("tx.clear_filters")}
            </button>
          </div>
        ) : (
          filteredTransactions.value.map((tx) => (
            <div key={tx.id} id={`tx-${tx.id}`} data-tour="transaction-card">
              <TransactionCardClickable
                tx={tx}
                users={users.value}
                currentUserId={currentUserId.value}
                onClick={() => tx.type !== "ajuste" && openEdit(tx)}
                allTxs={transactions.value}
                transactionPayments={transactionPayments.value}
                locale={props.locale}
              />
            </div>
          ))
        )}
        <div class="h-12" />
      </main>

      <div class="hidden sm:flex fixed bottom-8 right-8 z-50 flex-col gap-3">
        <div class="group relative">
          <span class="absolute right-full top-1/2 -translate-y-1/2 mr-3 whitespace-nowrap bg-surface text-white text-sm px-3 py-1.5 rounded-custom shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {t("tx.add_payment_tooltip")}
          </span>
          <button
            type="button"
            onClick={openNewPago}
            data-tour="add-payment"
            class="w-16 h-16 bg-green-700 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all"
          >
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </button>
        </div>
        <div class="group relative">
          <span class="absolute right-full top-1/2 -translate-y-1/2 mr-3 whitespace-nowrap bg-surface text-white text-sm px-3 py-1.5 rounded-custom shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {t("tx.add_expense_tooltip")}
          </span>
          <button
            type="button"
            onClick={openNew}
            data-tour="add-expense"
            class="w-16 h-16 bg-yellow-500 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all"
          >
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </button>
        </div>
      </div>

      <TransactionModal
        isOpen={isOpen}
        editingId={editingId}
        modalMode={modalMode}
        transactions={transactions}
        users={users}
        currentUserId={currentUserId}
        registryId={registryId}
        balanceEntries={balanceEntries}
        defaultSplit={defaultSplit}
        entityIds={props.entityIds}
        entities={props.entities}
        transactionPayments={transactionPayments}
        onRecalculate={recalculate}
        onServerStamp={(stamp) => (props.lastModified.value = stamp)}
        isDemo={props.isDemo}
        locale={props.locale}
      />
    </>
  );
}
