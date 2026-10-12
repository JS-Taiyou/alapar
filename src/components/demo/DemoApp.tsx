/** @jsxImportSource react */
import { useReducer } from "react";
import TransactionList from "../dashboard/TransactionList";
import BalanceBreakdown from "../dashboard/BalanceBreakdown";
import {
  dashboardReducer,
  type DashboardState,
} from "../dashboard/dashboard-store";
import DemoTour from "./DemoTour";
import LocaleToggle from "../ui/LocaleToggle";
import type { Locale } from "../../lib/i18n";
import type {
  BalanceBreakdownEntry,
  EnrichedTransaction,
  Participant,
  TransactionPayment,
} from "../../lib/types";

/**
 * Page-level root for /demo. Runs the same dashboard reducer as the real
 * DashboardShell with static seed data — TransactionList and the transaction
 * modal work unchanged, and all their writes flow through the reducer.
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
  const [state, dispatch] = useReducer(dashboardReducer, props, initialDemoState);

  const hasMultipleParticipants = state.users.length > 1;

  return (
    <>
      {hasMultipleParticipants && (
        <header className="p-4 sm:p-6 bg-[#0a0a0a] border-b border-white/10 flex justify-between items-center gap-2">
          <BalanceBreakdown
            balance={state.balance}
            entries={state.balanceEntries}
            users={state.users}
            locale={locale}
          />
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <LocaleToggle locale={locale} />
            <a
              href="/"
              className="p-3 bg-card hover:bg-white/5 transition-colors rounded-custom text-gray-300"
              title="Inicio"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </a>
          </div>
        </header>
      )}
      <TransactionList state={state} dispatch={dispatch} isDemo locale={locale} />
      <DemoTour locale={locale} />
    </>
  );
}

function initialDemoState(props: DemoAppProps): DashboardState {
  return {
    registryId: props.registryId,
    transactions: props.transactions,
    transactionPayments: props.transactionPayments,
    users: props.users,
    currentUserId: props.currentUserId,
    balance: props.balance,
    balanceEntries: props.balanceBreakdown,
    defaultSplit: null,
    spawnCandidates: [],
    lastModified: null,
    entityIds: new Set(props.entities.map((e) => e.id)),
    entities: props.entities,
  };
}
