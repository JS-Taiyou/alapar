import { type Locale, t } from "../lib/i18n";

/**
 * Locked-history placeholder: shows that older cuts exist and teases the Pro
 * upgrade. Rendered by the history page for free registries.
 */
export default function PaywallCard(
  { locale, lockedCount, registryId }: {
    locale: Locale;
    lockedCount: number;
    registryId?: string;
  },
) {
  return (
    <div class="relative rounded-custom border border-dashed border-white/15 bg-white/[0.02] p-5 text-center overflow-hidden">
      {/* Blur hint of "hidden" rows */}
      <div class="absolute inset-x-0 top-0 h-full pointer-events-none select-none opacity-30 blur-[2px]">
        <div class="h-4 bg-white/5 rounded-custom mb-2 w-3/4 mx-auto" />
        <div class="h-4 bg-white/5 rounded-custom mb-2 w-2/3 mx-auto" />
        <div class="h-4 bg-white/5 rounded-custom w-5/6 mx-auto" />
      </div>
      <div class="relative z-10">
        <span class="inline-block text-[10px] font-bold tracking-widest bg-primary/20 text-primary-light px-2 py-0.5 rounded-full mb-2">
          {t(locale, "billing.pro_badge")}
        </span>
        <p class="text-sm text-zinc-300 font-medium mb-1">
          {t(locale, "billing.history_locked")} ({lockedCount})
        </p>
        <a
          href={registryId ? `/pricing?registry_id=${registryId}` : "/pricing"}
          class="inline-block mt-2 px-4 py-2 text-sm btn-primary rounded-custom transition-all shadow-lg active:scale-95"
        >
          {t(locale, "billing.history_locked_cta")}
        </a>
      </div>
    </div>
  );
}
