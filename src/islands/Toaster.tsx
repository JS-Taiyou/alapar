import { useEffect, useState } from "preact/hooks";
import { type Locale, t as translate } from "../lib/i18n";
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type UpgradeToast,
} from "../components/ui/toast-store";

/**
 * Preact binding over the framework-agnostic toast store — transitional,
 * replaced by the React Toaster when the dashboard cluster ports. The store
 * (and showUpgradeToast, re-exported below) is the stable contract.
 */
export { showUpgradeToast } from "../components/ui/toast-store";
export type { UpgradeToast };

export default function Toaster() {
  const [toasts, setToasts] = useState<UpgradeToast[]>(getToasts);

  useEffect(() => subscribeToasts(() => setToasts(getToasts())), []);

  return (
    <div class="fixed top-20 right-4 sm:right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((toast) => {
        const t = (key: string) => translate(toast.locale, key);
        return (
          <div
            key={toast.id}
            role="status"
            class="pointer-events-auto flex items-center gap-3 max-w-sm bg-surface border border-border-custom rounded-custom shadow-2xl px-4 py-3"
          >
            <svg
              class="w-5 h-5 shrink-0 text-primary-light"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <span class="text-sm text-zinc-200">{t(toast.messageKey)}</span>
            <a
              href="/pricing"
              class="text-sm font-semibold text-primary-light hover:text-white transition-colors shrink-0"
            >
              {t("billing.view_plans")} →
            </a>
            <button
              type="button"
              aria-label={t("common.cancel")}
              onClick={() => dismissToast(toast.id)}
              class="text-zinc-500 hover:text-white transition-colors shrink-0"
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
          </div>
        );
      })}
    </div>
  );
}
