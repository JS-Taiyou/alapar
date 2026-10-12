import { type Signal, useSignal } from "@preact/signals";
import type { BalanceBreakdownEntry, Participant } from "../lib/types";
import { type Locale, t as translate } from "../lib/i18n";
import { formatMoney, initials } from "../lib/format";

interface BalanceBreakdownProps {
  balance: Signal<number>;
  entries: Signal<BalanceBreakdownEntry[]>;
  users: Signal<Participant[]>;
  locale?: Locale;
}

export default function BalanceBreakdown(props: BalanceBreakdownProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);
  const showPopover = useSignal(false);

  const balance = props.balance.value;
  const entries = props.entries.value;
  const usersCount = props.users.value.length;

  const owedToMe = entries.filter((e) => e.amount > 0);
  const owedByMe = entries.filter((e) => e.amount < 0);
  const canShowPopover = usersCount > 2;

  function toggle() {
    if (canShowPopover) showPopover.value = !showPopover.value;
  }

  function close() {
    showPopover.value = false;
  }

  // Display waiver: amounts under $0.02 are shown as $0.00 to avoid
  // showing a meaningless 1-cent remainder after a full payment.
  const displayBalance = Math.abs(balance) < 0.02 ? 0 : balance;
  // Sign before the $ ("-$11.99", never "$-11.99"), matching the popover's
  // +$/-$ convention and the transaction cards.
  const balanceStr = (displayBalance < 0 ? "-$" : "$") + formatMoney(Math.abs(displayBalance));

  return (
    <div class="relative min-w-0 shrink">
      <button
        type="button"
        onClick={toggle}
        data-tour="balance-total"
        class={`text-left min-w-0 ${canShowPopover ? "cursor-pointer group" : "cursor-default"}`}
      >
        <div class="flex items-center gap-2">
          <span class="text-xs sm:text-sm font-medium text-zinc-400 uppercase tracking-wider">
            {t("balance.total")}
          </span>
          {canShowPopover && (
            <svg
              class={`w-4 h-4 transition-all duration-200 ${
                showPopover.value
                  ? "text-primary rotate-180"
                  : "text-zinc-500 group-hover:text-zinc-400"
              }`}
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
          )}
        </div>
        <p
          class={`text-2xl sm:text-3xl lg:text-4xl font-bold mt-1 truncate ${
            displayBalance >= 0 ? "text-green-500" : "text-red-500"
          }`}
        >
          {balanceStr}
        </p>
      </button>

      {showPopover.value && (
        <>
          <div class="fixed inset-0 z-40" onClick={close} />
          <div class="absolute top-full left-0 mt-3 z-50 w-80 bg-surface border border-border-custom rounded-custom shadow-2xl overflow-hidden animate-fade-in">
            <div class="px-4 py-3 border-b border-border-custom bg-white/5">
              <h3 class="text-sm font-semibold text-white">{t("balance.breakdown_title")}</h3>
              <p class="text-xs text-zinc-400 mt-0.5">{t("balance.breakdown_subtitle")}</p>
            </div>

            {entries.length === 0 ? (
              <div class="px-4 py-6 text-center">
                <svg
                  class="w-8 h-8 text-emerald-500 mx-auto mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <p class="text-sm text-zinc-400">{t("balance.all_settled")}</p>
              </div>
            ) : (
              <div>
                {owedToMe.length > 0 && (
                  <div class="px-4 py-3 space-y-2.5">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-green-400/80">
                      {t("balance.owed_to_you")}
                    </h4>
                    {owedToMe.map((entry) => {
                      const userInitials = initials(entry.userName);
                      return (
                        <div key={entry.userId} class="flex items-center justify-between">
                          <div class="flex items-center gap-2.5">
                            <div
                              class="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={`background-color: ${entry.userColor}25; color: ${entry.userColor}`}
                            >
                              {userInitials}
                            </div>
                            <span class="text-sm text-zinc-300">{entry.userName}</span>
                          </div>
                          <span class="text-sm font-semibold text-green-400">
                            +$
                            {formatMoney(entry.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {owedToMe.length > 0 && owedByMe.length > 0 && (
                  <div class="border-t border-border-custom" />
                )}

                {owedByMe.length > 0 && (
                  <div class="px-4 py-3 space-y-2.5">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-red-400/80">
                      {t("balance.you_owe")}
                    </h4>
                    {owedByMe.map((entry) => {
                      const userInitials = initials(entry.userName);
                      return (
                        <div key={entry.userId} class="flex items-center justify-between">
                          <div class="flex items-center gap-2.5">
                            <div
                              class="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={`background-color: ${entry.userColor}25; color: ${entry.userColor}`}
                            >
                              {userInitials}
                            </div>
                            <span class="text-sm text-zinc-300">{entry.userName}</span>
                          </div>
                          <span class="text-sm font-semibold text-red-400">
                            -$
                            {formatMoney(Math.abs(entry.amount))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
