/** @jsxImportSource react */
import { type Locale, t as translate } from "../../lib/i18n";

/**
 * "Upgrade to Pro" CTA in the sidebar (free-plan active registry only).
 * Funnels to the public pricing page — the tier comparison, interval
 * switcher and checkout all live there.
 *
 * Shown identically for owners and members: a subscription is per-user and
 * makes every group the subscriber belongs to Pro, so ANY member can lift
 * the group's limits.
 */
export default function UpgradeButton({ locale }: { locale: Locale }) {
  const t = (key: string) => translate(locale, key);

  return (
    <a
      href="/pricing"
      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-primary-light hover:opacity-90 border border-primary-light/40 rounded-custom text-sm font-semibold text-white transition-all py-2.5 px-4"
      title={t("billing.upgrade_hint_owner")}
    >
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
      <span className="whitespace-nowrap">{t("billing.upgrade")}</span>
    </a>
  );
}
