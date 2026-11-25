import DashboardShell from "../dashboard/DashboardShell";
import DemoTour from "./DemoTour";
import type { DemoBook } from "./demo-data";
import { initials } from "../../lib/format";
import type { Locale } from "../../lib/i18n";
import type { User } from "../../lib/types";

/**
 * Page-level root for /demo: the real DashboardShell in demo mode. The books
 * are static seed data, so the Sidebar, TransactionList and the transaction
 * modal all work unchanged — book switching included — and every write stays
 * in memory for the length of the visit.
 */
interface DemoAppProps {
  user: User;
  books: DemoBook[];
  locale: Locale;
}

export default function DemoApp(props: DemoAppProps) {
  const { user, books, locale } = props;
  const first = books[0];

  return (
    <DashboardShell
      isDemo
      demoSnapshots={Object.fromEntries(books.map((b) => [b.registry.id, b.snapshot]))}
      registries={books.map((b) => b.registry)}
      userName={user.name}
      userInitials={initials(user.name)}
      userPro={null}
      isOwner={first.ownerId === user.id}
      ownerRegistryIds={
        new Set(books.filter((b) => b.ownerId === user.id).map((b) => b.registry.id))
      }
      // Read only by the default-split dialog, which the demo doesn't offer.
      registryUsers={first.users}
      defaultSplit={first.snapshot.defaultSplit}
      // Deleting a book is a server-side operation the demo can't perform.
      deletableRegistryIds={new Set()}
      // Always open: the books are what the demo is here to show.
      initialCollapsed={false}
      entities={[]}
      showUpgrade={false}
      locale={locale}
      transactions={first.snapshot.transactions}
      transactionPayments={first.snapshot.transactionPayments}
      balance={first.snapshot.balance}
      currentUserId={user.id}
      spawnCandidates={first.snapshot.spawnCandidates}
      balanceBreakdown={first.snapshot.balanceEntries}
      participants={first.snapshot.users}
      registryId={first.registry.id}
      lastModified={first.snapshot.lastModified}
      remainderQueue={first.snapshot.remainderQueue}
      hasTransactions={first.snapshot.transactions.length > 0}
    >
      <DemoTour locale={locale} />
    </DashboardShell>
  );
}
