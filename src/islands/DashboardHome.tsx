import { useSignal } from "@preact/signals";
import TransactionList from "./TransactionList";
import CortarButton from "./CortarButton";
import RecurringSpawn from "./RecurringSpawn";
import BalanceBreakdown from "./BalanceBreakdown";
import type { Locale } from "../lib/i18n";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Participant,
  SpawnCandidate,
  TransactionPayment,
} from "../lib/types";
import type { EnrichedTransaction } from "./shared-signals";

/**
 * Page-level island for /dashboard: the Fresh route created its signals in
 * the page component and passed them to the TransactionList /
 * BalanceBreakdown / RecurringSpawn / CortarButton islands; in Astro that
 * composition must live inside a single hydrated island. The .astro page
 * queries the data and passes it as plain props.
 */
interface DashboardHomeProps {
  transactions: EnrichedTransaction[];
  transactionPayments: TransactionPayment[];
  balance: number;
  currentUserId: string;
  spawnCandidates: SpawnCandidate[];
  balanceBreakdown: BalanceBreakdownEntry[];
  participants: Participant[];
  entities: { id: string; name: string; color: string }[];
  registryId: string;
  defaultSplit: DefaultSplit | null;
  lastModified: string | null;
  supabaseUrl: string;
  supabaseAnonKey: string;
  hasTransactions: boolean;
  locale: Locale;
}

export default function DashboardHome(props: DashboardHomeProps) {
  const $transactions = useSignal<EnrichedTransaction[]>(props.transactions);
  const $users = useSignal<Participant[]>(props.participants);
  const $currentUserId = useSignal(props.currentUserId);
  const $registryId = useSignal(props.registryId);
  const $balance = useSignal(props.balance);
  const $balanceEntries = useSignal<BalanceBreakdownEntry[]>(
    props.balanceBreakdown,
  );
  const $defaultSplit = useSignal<DefaultSplit | null>(props.defaultSplit);
  const $spawnCandidates = useSignal(props.spawnCandidates);
  const $lastModified = useSignal<string | null>(props.lastModified);
  const $entities = useSignal<{ id: string; name: string; color: string }[]>(
    props.entities,
  );
  const $entityIds = useSignal<Set<string>>(
    new Set(props.entities.map((e) => e.id)),
  );
  const $transactionPayments = useSignal<TransactionPayment[]>(
    props.transactionPayments,
  );

  const hasMultipleParticipants =
    $users.value.length + $entities.value.length > 1;

  return (
    <>
      {hasMultipleParticipants && (
        <header class="p-4 sm:p-6 bg-[#0a0a0a] border-b border-white/10 flex justify-between items-center gap-2">
          <BalanceBreakdown
            balance={$balance}
            entries={$balanceEntries}
            users={$users}
            locale={props.locale}
          />
          <div class="flex items-center gap-2 sm:gap-4 shrink-0">
            <RecurringSpawn candidates={$spawnCandidates} />
            <a
              href="/dashboard/history"
              class="p-3 bg-card hover:bg-white/5 transition-colors rounded-custom text-gray-300"
              title="Histórico"
            >
              <svg
                class="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </a>
            <CortarButton
              hasTransactions={props.hasTransactions}
              registryId={$registryId.value}
            />
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
        supabaseUrl={props.supabaseUrl}
        supabaseAnonKey={props.supabaseAnonKey}
        locale={props.locale}
      />
    </>
  );
}
