/**
 * Internationalization (i18n) system.
 *
 * A lightweight, zero-dependency translation layer. Each locale has a flat
 * key→string dictionary (`lib/locales/es.ts`, `lib/locales/en.ts`). The `t()`
 * function looks up a key in the active locale, falling back to Spanish, then
 * to the raw key if missing.
 *
 * Interpolation: `{name}` placeholders in strings are replaced by params.
 * Example: `t("en", "paid_by", { name: "Ana" })` → `"You paid"`
 *
 * Locale detection: the middleware reads the `alapar-locale` cookie and stores
 * it in `ctx.state.locale`. Islands receive `locale` as a prop.
 */

import { es } from "./locales/es";
import { en } from "./locales/en";

export type Locale = "es" | "en";

const dictionaries: Record<Locale, Record<string, string>> = { es, en };

const DATE_LOCALE: Record<Locale, string> = {
  es: "es-MX",
  en: "en-US",
};

/**
 * Look up a translation key in the active locale.
 * Falls back to ES, then to the key itself.
 */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let str = dictionaries[locale]?.[key] ?? dictionaries.es[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

/**
 * Create a locale-bound `t` function for use inside an island or component.
 * Usage: `const t = tt(props.locale);` then `t("modal.save")`.
 */
export function tt(
  locale: Locale,
): (key: string, params?: Record<string, string | number>) => string {
  return (key, params) => t(locale, key, params);
}

/** Resolve locale from a cookie value, Accept-Language header, or default. */
export function resolveLocale(cookieValue?: string | null, acceptLanguage?: string | null): Locale {
  if (cookieValue === "es" || cookieValue === "en") return cookieValue;
  if (acceptLanguage?.toLowerCase().startsWith("en")) return "en";
  return "es";
}

/** Format a date according to the active locale. */
export function formatDate(
  date: Date | string,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(
    DATE_LOCALE[locale],
    options ?? { year: "numeric", month: "short", day: "numeric" },
  );
}

/** Format a time according to the active locale. */
export function formatTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(DATE_LOCALE[locale], { hour: "2-digit", minute: "2-digit" });
}

/** Format a month + year for exercise/corte headings. */
export function formatMonthYear(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(DATE_LOCALE[locale], { month: "long", year: "numeric" });
}
