import type { Locale } from "../lib/i18n";

/**
 * A compact ES/EN language toggle styled as a segmented control. Sends a
 * POST to /api/locale to set the cookie, then reloads the page so SSR
 * re-renders in the new language.
 *
 * `full` stretches the control to its container's width (sidebar footer);
 * otherwise it sizes to its content (landing corner, demo header).
 */
export default function LocaleToggle(
  { locale, class: className, full }: {
    locale: Locale;
    class?: string;
    full?: boolean;
  },
) {
  function switchLocale(newLocale: Locale) {
    if (newLocale === locale) return;
    fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: newLocale }),
    }).then(() => globalThis.location.reload()).catch(() =>
      globalThis.location.reload()
    );
  }

  const labels: Record<Locale, string> = { es: "ES", en: "EN" };

  return (
    <div
      role="group"
      aria-label="Idioma / Language"
      class={`inline-flex items-center gap-0.5 rounded-custom border border-white/10 bg-surface/80 p-0.5 backdrop-blur-sm ${
        full ? "w-full" : ""
      } ${className ?? ""}`}
    >
      {(["es", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          onClick={() => switchLocale(l)}
          class={`px-2.5 py-1 rounded-[6px] text-[11px] font-semibold tracking-widest uppercase transition-colors ${
            full ? "flex-1" : ""
          } ${
            locale === l
              ? "bg-primary text-white shadow-sm shadow-primary/40"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
          }`}
        >
          {labels[l]}
        </button>
      ))}
    </div>
  );
}
