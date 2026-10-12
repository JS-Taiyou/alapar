import { useSignal } from "@preact/signals";
import TransactionList from "./TransactionList";
import BalanceBreakdown from "./BalanceBreakdown";
import DemoTour from "./DemoTour";
import LocaleToggle from "./LocaleToggle";
import type { Locale } from "../lib/i18n";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  TransactionPayment,
} from "../lib/types";
import type { EnrichedTransaction } from "./shared-signals";

/**
 * Page-level island for /demo: the Fresh route created its signals in the
 * page component and passed them to the TransactionList/BalanceBreakdown
 * islands; in Astro that composition must live inside a single hydrated
 * island. The .astro page computes the data and passes it as plain props.
 */
interface DemoAppProps {
  registryId: string;
  transactions: EnrichedTransaction[];
  transactionPayments: TransactionPayment[];
  balance: number;
  currentUserId: string;
  balanceBreakdown: BalanceBreakdownEntry[];
  users: Participant[];
  entities: { id: string; name: string; color: string }[];
  locale: Locale;
}

export default function DemoApp(props: DemoAppProps) {
  const locale = props.locale;
  const $transactions = useSignal<EnrichedTransaction[]>(props.transactions);
  const $users = useSignal<Participant[]>(props.users);
  const $currentUserId = useSignal(props.currentUserId);
  const $registryId = useSignal(props.registryId);
  const $balance = useSignal(props.balance);
  const $balanceEntries = useSignal<BalanceBreakdownEntry[]>(props.balanceBreakdown);
  const $defaultSplit = useSignal<DefaultSplit | null>(null);
  const $spawnCandidates = useSignal([]);
  const $lastModified = useSignal<string | null>(null);
  const $entityIds = useSignal<Set<string>>(new Set());
  const $entities = useSignal<{ id: string; name: string; color: string }[]>(props.entities);
  const $transactionPayments = useSignal<TransactionPayment[]>(props.transactionPayments);

  const hasMultipleParticipants = $users.value.length > 1;

  return (
    <>
      {hasMultipleParticipants && (
        <header class="p-4 sm:p-6 bg-[#0a0a0a] border-b border-white/10 flex justify-between items-center gap-2">
          <BalanceBreakdown
            balance={$balance}
            entries={$balanceEntries}
            users={$users}
            locale={locale}
          />
          <div class="flex items-center gap-2 sm:gap-4 shrink-0">
            <LocaleToggle locale={locale} />
            <a
              href="/"
              class="p-3 bg-card hover:bg-white/5 transition-colors rounded-custom text-gray-300"
              title="Inicio"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </a>
          </div>
        </header>
      )}
      <TransactionList
        transactions={$transactions}
        users={$users}
        currentUserId={$currentUserId}
        registryId={$registryId}
        balance={$balance}
        balanceEntries={$balanceEntries}
        defaultSplit={$defaultSplit}
        spawnCandidates={$spawnCandidates}
        lastModified={$lastModified}
        entityIds={$entityIds}
        entities={$entities}
        transactionPayments={$transactionPayments}
        isDemo
        locale={locale}
      />
      <DemoTour locale={locale} />
    </>
  );
}
