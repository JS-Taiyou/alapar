import type { ComponentChildren } from "preact";

interface AuthCardLayoutProps {
  /** Kept for parity with the Fresh version; Astro pages set <title> via the
   * Base layout, so this prop is informational only. */
  pageTitle: string;
  children: ComponentChildren;
  centered?: boolean;
}

export default function AuthCardLayout({ children, centered = false }: AuthCardLayoutProps) {
  const cardClasses = centered
    ? "bg-surface border border-border-custom rounded-custom p-8 w-full max-w-md z-10 text-center"
    : "bg-surface border border-border-custom rounded-custom p-8 w-full max-w-md z-10";

  return (
    <>
      <main class="min-h-screen flex items-center justify-center p-6 bg-pattern">
        <div class="absolute inset-0 gradient-glow pointer-events-none" />
        <div class={cardClasses}>{children}</div>
      </main>
    </>
  );
}
