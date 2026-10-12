/** @jsxImportSource react */
import { useEffect, useReducer, useRef } from "react";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Entity,
  EnrichedTransaction,
  Participant,
  Registry,
  SpawnCandidate,
  TransactionPayment,
  User,
} from "../../lib/types";
import { cache } from "../../lib/cache";
import type { Locale } from "../../lib/i18n";
import Sidebar from "./Sidebar";
import TransactionList from "./TransactionList";
import BalanceBreakdown from "./BalanceBreakdown";
import RecurringSpawn from "./RecurringSpawn";
import CortarButton from "./CortarButton";
import Toaster from "../ui/Toaster";
import { dashboardReducer, type DashboardState, type RegistrySnapshot } from "./dashboard-store";

/**
 * The /dashboard hydration root. In the Fresh (and early Astro) layout the
 * Sidebar and the transaction list were separate islands that synchronized
 * through module-level signals (shared-signals.ts); this shell collapses
 * them into a single React tree so the registry state lives in one reducer.
 * The .astro page gathers all server data and passes it as plain props.
 */
interface DashboardShellProps {
  // Sidebar chrome (server data)
  registries: Registry[];
  userName: string;
  userInitials: string;
  userPro: User["pro"];
  isOwner: boolean;
  ownerRegistryIds: Set<string>;
  entities: Entity[];
  registryUsers: User[];
  defaultSplit: DefaultSplit | null;
  deletableRegistryIds: Set<string>;
  initialCollapsed: boolean;
  locale: Locale;
  showUpgrade: boolean;
  // Content (server data)
  transactions: EnrichedTransaction[];
  transactionPayments: TransactionPayment[];
  balance: number;
  currentUserId: string;
  spawnCandidates: SpawnCandidate[];
  balanceBreakdown: BalanceBreakdownEntry[];
  participants: Participant[];
  registryId: string;
  lastModified: string | null;
  supabaseUrl: string;
  supabaseAnonKey: string;
  hasTransactions: boolean;
}

export default function DashboardShell(props: DashboardShellProps) {
  const [state, dispatch] = useReducer(dashboardReducer, props, initialReducerArg);

  // Staleness guard for the async registry-switch flow (was `switchGen`).
  const switchGen = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Apply a registry snapshot after any await, unless a newer switch won. */
  function applySnapshot(snapshot: RegistrySnapshot) {
    dispatch({ type: "APPLY_SNAPSHOT", snapshot });
  }

  async function switchRegistry(id: string) {
    if (id === stateRef.current.registryId) return;

    const gen = ++switchGen.current;
    cache.setLastActiveRegistry(id).catch(() => {});

    const cached = await cache.getRegistrySnapshot(id);
    if (gen !== switchGen.current) return;

    if (cached && cached.transactions && cached.entities) {
      // The IndexedDB snapshot stores dates as ISO strings; the reducer
      // re-coerces them on apply.
      applyRegistrySwitch({
        registryId: id,
        transactions: cached.transactions,
        transactionPayments: cached.transactionPayments as TransactionPayment[] | undefined,
        balance: cached.balance,
        balanceEntries: cached.balanceEntries as BalanceBreakdownEntry[],
        users: cached.users as Participant[],
        currentUserId: cached.currentUserId,
        defaultSplit: cached.defaultSplit as DefaultSplit | null,
        spawnCandidates: cached.spawnCandidates as SpawnCandidate[],
        entityIds: cached.entityIds ?? [],
        entities: cached.entities,
        lastModified: cached.lastModified,
      });

      validateCacheInBackground(id, cached.lastModified, gen);
      return;
    }

    try {
      const res = await fetch(`/api/dashboard?registryId=${id}`, {
        cache: "no-store",
      });
      if (gen !== switchGen.current) return;
      if (!res.ok) throw new Error();
      const data = (await res.json()) as RegistrySnapshot;
      applyRegistrySwitch({ ...data, registryId: id });
    } catch {
      if (gen !== switchGen.current) return;
      globalThis.location.href = "/dashboard";
    }
  }

  function applyRegistrySwitch(snapshot: RegistrySnapshot) {
    applySnapshot(snapshot);
  }

  async function validateCacheInBackground(
    registryId: string,
    cachedLastModified: string | null,
    gen: number,
  ) {
    try {
      const stampRes = await fetch(`/api/stamp/${registryId}`, {
        method: "POST",
        cache: "no-store",
      });
      if (gen !== switchGen.current) return;
      if (!stampRes.ok) return;
      const { lastModified } = (await stampRes.json()) as {
        lastModified: string | null;
      };

      // Null stamp = version unknown → always refetch, never "in sync".
      if (lastModified && lastModified === cachedLastModified) return;

      const dashRes = await fetch(`/api/dashboard?registryId=${registryId}`, {
        cache: "no-store",
      });
      if (gen !== switchGen.current) return;
      if (!dashRes.ok) return;
      const data = (await dashRes.json()) as RegistrySnapshot;
      applyRegistrySwitch({ ...data, registryId, lastModified });
    } catch {
      /* background validation failure is non-critical */
    }
  }

  // On mount: drop IndexedDB snapshots for deleted registries and pick up
  // where the last session left off (the last active registry).
  useEffect(() => {
    if (typeof globalThis.indexedDB === "undefined") return;
    cache.cleanOrphanedEntries(props.registries.map((r) => r.id)).catch(() => {});
    cache.getLastActiveRegistry().then((cachedId) => {
      if (
        cachedId &&
        cachedId !== props.registryId &&
        props.registries.some((r) => r.id === cachedId)
      ) {
        void switchRegistry(cachedId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMultipleParticipants = state.users.length + state.entities.length > 1;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        registries={props.registries}
        activeRegistryId={state.registryId}
        userName={props.userName}
        userInitials={props.userInitials}
        userPro={props.userPro}
        isOwner={props.isOwner}
        ownerRegistryIds={props.ownerRegistryIds}
        entities={state.entities}
        registryUsers={props.registryUsers}
        defaultSplit={props.defaultSplit}
        deletableRegistryIds={props.deletableRegistryIds}
        initialCollapsed={props.initialCollapsed}
        locale={props.locale}
        showUpgrade={props.showUpgrade}
        onRegistrySwitch={switchRegistry}
        onEntitiesChanged={(entities: Entity[]) => dispatch({ type: "SET_ENTITIES", entities })}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {hasMultipleParticipants && (
          <header className="p-4 sm:p-6 bg-[#0a0a0a] border-b border-white/10 flex justify-between items-center gap-2">
            <BalanceBreakdown
              balance={state.balance}
              entries={state.balanceEntries}
              users={state.users}
              locale={props.locale}
            />
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <RecurringSpawn candidates={state.spawnCandidates} />
              <a
                href="/dashboard/history"
                className="p-3 bg-card hover:bg-white/5 transition-colors rounded-custom text-gray-300"
                title="Histórico"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </a>
              <CortarButton
                hasTransactions={props.hasTransactions}
                registryId={state.registryId}
              />
            </div>
          </header>
        )}
        <TransactionList
          state={state}
          dispatch={dispatch}
          supabaseUrl={props.supabaseUrl}
          supabaseAnonKey={props.supabaseAnonKey}
          locale={props.locale}
        />
      </div>
      <Toaster />
    </div>
  );
}

/** Seed the reducer from the server-rendered props. */
function initialReducerArg(props: DashboardShellProps): DashboardState {
  return {
    registryId: props.registryId,
    transactions: props.transactions,
    transactionPayments: props.transactionPayments,
    users: props.participants,
    currentUserId: props.currentUserId,
    balance: props.balance,
    balanceEntries: props.balanceBreakdown,
    defaultSplit: props.defaultSplit,
    spawnCandidates: props.spawnCandidates,
    lastModified: props.lastModified,
    entityIds: new Set(props.entities.map((e) => e.id)),
    entities: props.entities,
  };
}
