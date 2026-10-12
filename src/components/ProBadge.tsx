import { type Locale, t } from "../lib/i18n";
import type { User } from "../lib/types";

/**
 * The golden crown shown next to a Pro user's name.
 *
 *   subscribed    → links to /pricing so the member (or anyone curious about
 *                   the badge) lands on the subscription management screen
 *                   (upgrade / switch / cancel)
 *   grandfathered → founding member, Pro forever — nothing to manage, the
 *                   crown is inert
 *
 * `linked={false}` renders a plain span for contexts where an anchor can't
 * be nested (e.g. inside the filter-chip <button>s in TransactionList).
 */
export default function ProBadge(props: {
  pro: User["pro"];
  locale?: Locale;
  linked?: boolean;
  size?: "sm" | "md";
}) {
  if (!props.pro) return null;
  const founding = props.pro === "grandfathered";
  const title = t(props.locale ?? "es", founding ? "pro.crown_founding" : "pro.crown_sub");
  const crown = (
    <svg
      class={`${props.size === "md" ? "w-4 h-4" : "w-3.5 h-3.5"} text-amber-400 shrink-0`}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1v-1h14v1z" />
    </svg>
  );
  if (founding || props.linked === false) {
    return (
      <span title={title} class="inline-flex items-center" aria-label={title}>
        {crown}
      </span>
    );
  }
  return (
    <a
      href="/pricing"
      title={title}
      aria-label={title}
      class="inline-flex items-center hover:opacity-75 transition-opacity"
    >
      {crown}
    </a>
  );
}
