import { useEffect, useId, useRef, useState } from "react";
import type { BalanceBreakdownEntry, Participant } from "../../lib/types";
import { type Locale, t as translate } from "../../lib/i18n";
import { formatMoney, initials } from "../../lib/format";

interface BalanceBreakdownProps {
  balance: number;
  entries: BalanceBreakdownEntry[];
  users: Participant[];
  locale?: Locale;
}

export default function BalanceBreakdown(props: BalanceBreakdownProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);
  const [showPopover, setShowPopover] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverTitleId = useId();

  // Escape closes the open popover; every close hands focus back to the
  // trigger, since the click-away layer is not focusable and a click on it
  // would otherwise leave focus nowhere.
  useEffect(() => {
    if (!showPopover) return;
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPopover(false);
    }
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      triggerRef.current?.focus();
    };
  }, [showPopover]);

  const balance = props.balance;
  const entries = props.entries;
  const usersCount = props.users.length;

  const owedToMe = entries.filter((e) => e.amount > 0);
  const owedByMe = entries.filter((e) => e.amount < 0);
  const canShowPopover = usersCount > 2;

  function toggle() {
    if (canShowPopover) setShowPopover(!showPopover);
  }

  function close() {
    setShowPopover(false);
  }

  // Display waiver: amounts under $0.02 are shown as $0.00 to avoid
  // showing a meaningless 1-cent remainder after a full payment.
  const displayBalance = Math.abs(balance) < 0.02 ? 0 : balance;
  // Sign before the $ ("-$11.99", never "$-11.99"), matching the popover's
  // +$/-$ convention and the transaction cards.
  const balanceStr = (displayBalance < 0 ? "-$" : "$") + formatMoney(Math.abs(displayBalance));
  // Says in words what the sign and the colour alone only imply.
  const amount = `$${formatMoney(Math.abs(displayBalance))}`;
  const caption =
    displayBalance < 0
      ? t("balance.you_owe_total", { amount })
      : displayBalance > 0
        ? t("balance.owed_total", { amount })
        : t("balance.all_settled");

  return (
    <div className="relative min-w-0 shrink">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        data-tour="balance-total"
        aria-haspopup={canShowPopover ? "dialog" : undefined}
        aria-expanded={canShowPopover ? showPopover : undefined}
        // max-w-full: on a narrow phone the wrapper shrinks below the text,
        // and the lines below truncate instead of running under the buttons.
        className={`text-left min-w-0 max-w-full ${
          canShowPopover ? "cursor-pointer group" : "cursor-default"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-medium text-zinc-400 uppercase tracking-wider">
            {t("balance.total")}
          </span>
          {canShowPopover && (
            <svg
              className={`w-4 h-4 transition-all duration-200 ${
                showPopover
                  ? "text-primary-text rotate-180"
                  : "text-zinc-400 group-hover:text-zinc-200"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M19 9l-7 7-7-7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          )}
        </div>
        <p
          className={`text-2xl sm:text-3xl lg:text-4xl font-bold mt-1 truncate tracking-tight ${
            displayBalance >= 0 ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {balanceStr}
        </p>
        <span className="block truncate text-xs sm:text-sm text-zinc-400 mt-0.5">{caption}</span>
      </button>

      {showPopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="dialog"
            aria-labelledby={popoverTitleId}
            className="absolute top-full left-0 mt-3 z-50 w-80 bg-surface border border-border-custom rounded-custom shadow-2xl overflow-hidden animate-fade-in"
          >
            <div className="px-4 py-3 border-b border-border-custom bg-white/5">
              <h3 id={popoverTitleId} className="text-sm font-semibold text-white">
                {t("balance.breakdown_title")}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">{t("balance.breakdown_subtitle")}</p>
            </div>

            {entries.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <svg
                  className="w-8 h-8 text-emerald-400 mx-auto mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <p className="text-sm text-zinc-400">{t("balance.all_settled")}</p>
              </div>
            ) : (
              <div>
                {owedToMe.length > 0 && (
                  <div className="px-4 py-3 space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">
                      {t("balance.owed_to_you")}
                    </h4>
                    {owedToMe.map((entry) => {
                      const userInitials = initials(entry.userName);
                      return (
                        <div key={entry.userId} className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={{
                                backgroundColor: `${entry.userColor}25`,
                                color: "#fff",
                              }}
                            >
                              {userInitials}
                            </div>
                            <span className="text-sm text-zinc-300">{entry.userName}</span>
                          </div>
                          <span className="text-sm font-semibold text-emerald-400">
                            +$
                            {formatMoney(entry.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {owedToMe.length > 0 && owedByMe.length > 0 && (
                  <div className="border-t border-border-custom" />
                )}

                {owedByMe.length > 0 && (
                  <div className="px-4 py-3 space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-red-400/80">
                      {t("balance.you_owe")}
                    </h4>
                    {owedByMe.map((entry) => {
                      const userInitials = initials(entry.userName);
                      return (
                        <div key={entry.userId} className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={{
                                backgroundColor: `${entry.userColor}25`,
                                color: "#fff",
                              }}
                            >
                              {userInitials}
                            </div>
                            <span className="text-sm text-zinc-300">{entry.userName}</span>
                          </div>
                          <span className="text-sm font-semibold text-red-400">
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
