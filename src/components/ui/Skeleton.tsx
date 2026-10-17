/** @jsxImportSource react */

/**
 * shadcn-style skeleton — a gray block that pulses. Use for any
 * loading placeholder where content will appear.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-custom bg-white/[0.06] ${className}`} />;
}

/** A full transaction-card skeleton — avatar, lines, amount. */
export function TransactionCardSkeleton() {
  return (
    <div className="bg-card p-5 rounded-custom border border-white/5 flex justify-between items-center">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-56" />
      </div>
      <div className="text-right flex flex-col items-end gap-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

/** The dashboard content area while a registry switch is in flight. */
export function DashboardSkeleton() {
  return (
    <>
      <header className="p-4 sm:p-6 bg-[#0a0a0a] border-b border-white/10 flex justify-between items-center gap-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-6 space-y-4 relative">
        <Skeleton className="h-6 w-36 mb-2" />
        <div className="space-y-3">
          <TransactionCardSkeleton />
          <TransactionCardSkeleton />
          <TransactionCardSkeleton />
        </div>
      </main>
    </>
  );
}
