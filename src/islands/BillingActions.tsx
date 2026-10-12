import { useSignal } from "@preact/signals";
import Modal from "../components/Modal";
import { formatDate, type Locale, t as translate } from "../lib/i18n";

interface BillingActionsProps {
  locale: Locale;
  /** ISO date the paid period ends (from the subscription mirror). */
  activeUntil: string | null;
  /** Mirror's cancel_at_period_end — a cancel is already scheduled. */
  cancelScheduled: boolean;
  /** Interval the live subscription is on; null hides the switch action
   * (unknown, or Polar products aren't configured for both intervals). */
  currentInterval: "monthly" | "yearly" | null;
}

/**
 * The discrete billing controls shown on /pricing to a user with a live
 * subscription: cancel (with a confirm modal stating until when the
 * subscription stays active), reactivate (undo a scheduled cancel), a
 * prorated monthly↔yearly plan switch (with its own confirm modal — Polar
 * charges/credits the difference on the SAME subscription), and the hosted
 * Polar portal for payment method / invoices. The subscription is per-user —
 * every action affects ALL of the subscriber's registries at once.
 */
export default function BillingActions(props: BillingActionsProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale, key, params);

  const showCancelModal = useSignal(false);
  const showSwitchModal = useSignal(false);
  const busy = useSignal(false);
  const error = useSignal("");
  // Local override after a successful action so the UI reflects it without
  // needing the webhook (which only carries the flag on the next event).
  const scheduled = useSignal(props.cancelScheduled);

  const targetInterval = props.currentInterval === "monthly" ? "yearly" : "monthly";

  const activeUntilText = props.activeUntil
    ? formatDate(new Date(props.activeUntil), props.locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  async function post(body: Record<string, unknown>): Promise<Response> {
    return await fetch("/api/billing/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function handleCancel() {
    busy.value = true;
    error.value = "";
    try {
      const res = await post({});
      if (!res.ok) throw new Error();
      scheduled.value = true;
      showCancelModal.value = false;
    } catch {
      error.value = t("common.error_connection");
    }
    busy.value = false;
  }

  async function handleReactivate() {
    busy.value = true;
    error.value = "";
    try {
      const res = await post({ undo: true });
      if (!res.ok) throw new Error();
      scheduled.value = false;
    } catch {
      error.value = t("common.error_connection");
    }
    busy.value = false;
  }

  async function handleManage() {
    busy.value = true;
    error.value = "";
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json()) as { url?: string };
      if (res.ok && data.url) {
        globalThis.location.href = data.url;
        return; // keep busy on while the redirect lands
      }
      throw new Error();
    } catch {
      error.value = t("common.error_connection");
    }
    busy.value = false;
  }

  async function handleSwitch() {
    busy.value = true;
    error.value = "";
    try {
      const res = await fetch("/api/billing/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: targetInterval }),
      });
      if (!res.ok) throw new Error();
      // Reload so the badge, period end and switch label all re-render from
      // the mirrored state (the webhook is authoritative a beat later).
      globalThis.location.href = "/pricing?interval=" + targetInterval;
      return; // keep busy on while the reload lands
    } catch {
      error.value = t("billing.switch_error");
    }
    busy.value = false;
  }

  return (
    <div class="space-y-2">
      {scheduled.value ? (
        <>
          <p class="text-xs text-amber-300">
            {activeUntilText
              ? t("pricing.cancel_scheduled", { date: activeUntilText })
              : t("pricing.cancel_scheduled", { date: "" })}
          </p>
          <button
            type="button"
            onClick={handleReactivate}
            disabled={busy.value}
            class="text-xs font-semibold text-primary hover:text-primary-light transition-colors disabled:opacity-50"
          >
            {t("pricing.reactivate")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => (showCancelModal.value = true)}
          disabled={busy.value}
          class="text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
        >
          {t("pricing.cancel_link")}
        </button>
      )}

      <button
        type="button"
        onClick={handleManage}
        disabled={busy.value}
        class="block text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
      >
        {t("billing.manage")}
      </button>

      {props.currentInterval && !scheduled.value && (
        <button
          type="button"
          onClick={() => (showSwitchModal.value = true)}
          disabled={busy.value}
          class="block text-xs text-zinc-500 hover:text-primary-light transition-colors disabled:opacity-50"
        >
          {targetInterval === "yearly"
            ? t("billing.switch_to_yearly")
            : t("billing.switch_to_monthly")}
        </button>
      )}

      {error.value && <p class="text-xs text-red-400">{error.value}</p>}

      {showCancelModal.value && (
        <Modal
          onClose={() => (showCancelModal.value = false)}
          title={t("pricing.cancel_title")}
          closeLabel={t("common.close")}
          footer={
            <>
              <button
                type="button"
                onClick={() => (showCancelModal.value = false)}
                disabled={busy.value}
                class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
              >
                {t("pricing.keep_sub")}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy.value}
                class="px-6 py-2 text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {busy.value ? t("common.saving") : t("pricing.cancel_confirm")}
              </button>
            </>
          }
        >
          <div class="p-6">
            <p class="text-sm text-zinc-300 leading-relaxed">
              {t("pricing.cancel_body", {
                date: activeUntilText ?? "—",
              })}
            </p>
          </div>
        </Modal>
      )}

      {showSwitchModal.value && (
        <Modal
          onClose={() => (showSwitchModal.value = false)}
          title={t("billing.switch_title")}
          closeLabel={t("common.close")}
          footer={
            <>
              <button
                type="button"
                onClick={() => (showSwitchModal.value = false)}
                disabled={busy.value}
                class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
              >
                {t("billing.switch_keep")}
              </button>
              <button
                type="button"
                onClick={handleSwitch}
                disabled={busy.value}
                class="px-6 py-2 text-sm font-semibold text-primary hover:text-primary-light transition-colors disabled:opacity-50"
              >
                {busy.value ? t("common.saving") : t("billing.switch_confirm")}
              </button>
            </>
          }
        >
          <div class="p-6">
            <p class="text-sm text-zinc-300 leading-relaxed">
              {t("billing.switch_body", {
                plan: targetInterval === "yearly" ? t("billing.yearly") : t("billing.monthly"),
              })}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
