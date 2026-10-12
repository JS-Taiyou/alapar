/** @jsxImportSource react */
import { useSyncExternalStore } from "react";
import { t as translate } from "../../lib/i18n";
import { dismissToast, getToasts, subscribeToasts } from "./toast-store";

export { showUpgradeToast } from "./toast-store";

/**
 * Renders the upgrade toasts from the framework-agnostic store. A single
 * instance is mounted in the dashboard shell (present on every dashboard
 * page).
 */
export default function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);

  return (
    <div className="fixed top-20 right-4 sm:right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((toast) => {
        const t = (key: string) => translate(toast.locale, key);
        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex items-center gap-3 max-w-sm bg-surface border border-border-custom rounded-custom shadow-2xl px-4 py-3"
          >
            <svg
              className="w-5 h-5 shrink-0 text-primary-light"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            <span className="text-sm text-zinc-200">{t(toast.messageKey)}</span>
            <a
              href="/pricing"
              className="text-sm font-semibold text-primary-light hover:text-white transition-colors shrink-0"
            >
              {t("billing.view_plans")} →
            </a>
            <button
              type="button"
              aria-label={t("common.cancel")}
              onClick={() => dismissToast(toast.id)}
              className="text-zinc-500 hover:text-white transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
