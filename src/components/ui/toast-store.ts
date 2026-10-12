import type { Locale } from "../../lib/i18n";

/**
 * Upgrade toast — the 402 funnel. When a paywalled action fails inside a
 * form context (4th recurring template, 3rd owned registry), the data rolls
 * back and this toast surfaces the limit with a link to /pricing.
 *
 * Framework-agnostic module store: producers call {@link showUpgradeToast}
 * from anywhere client-side; a single <Toaster /> mounted in the dashboard
 * shell renders them. React binds with useSyncExternalStore; any other
 * renderer can subscribe the same way.
 */

export interface UpgradeToast {
  id: number;
  locale: Locale;
  messageKey: string;
}

let toasts: UpgradeToast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to toast changes; returns an unsubscribe function. */
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for useSyncExternalStore. */
export function getToasts(): UpgradeToast[] {
  return toasts;
}

export function dismissToast(id: number): void {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** Show an upgrade toast with the given (localized-at-render) message key
 * and a "Ver planes →" link. Auto-dismisses after 6 seconds. */
export function showUpgradeToast(locale: Locale, messageKey: string): void {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, locale, messageKey }];
  emit();
  setTimeout(() => dismissToast(id), 6000);
}
