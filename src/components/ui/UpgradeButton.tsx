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
// Collapsed sidebar: icon-only (the crown already decorates Pro users);
// expanded: crown + label.
export default function UpgradeButton({
  locale,
  collapsed,
}: {
  locale: Locale;
  collapsed?: boolean;
}) {
  const t = (key: string) => translate(locale, key);

  return (
    <a
      href="/pricing"
      className={`w-full flex items-center bg-gradient-to-r from-primary to-primary-light hover:opacity-90 border border-primary-light/40 rounded-custom text-sm font-semibold text-white transition-all ${
        collapsed ? "justify-center p-2.5 text-amber-300" : "justify-center gap-2 py-2.5 px-4"
      }`}
      title={t("billing.upgrade_hint_owner")}
    >
      {/* The Pro crown (same mark as ProBadge) — in collapsed mode it IS
          the button; expanded it decorates the label. */}
      <svg
        className={`${collapsed ? "w-5 h-5" : "w-4 h-4"} shrink-0`}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1v-1h14v1z" />
      </svg>
      {!collapsed && <span className="whitespace-nowrap">{t("billing.upgrade")}</span>}
    </a>
  );
}
