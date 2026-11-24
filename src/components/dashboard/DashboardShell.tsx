import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
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
import { t, type Locale } from "../../lib/i18n";
import Sidebar, { MobileMenuButton, useIsStandalone } from "./Sidebar";
import TransactionList from "./TransactionList";
import BalanceBreakdown from "./BalanceBreakdown";
import RecurringSpawn from "./RecurringSpawn";
import CortarButton from "./CortarButton";
import Toaster from "../ui/Toaster";
import { dashboardReducer, type DashboardState, type RegistrySnapshot } from "./dashboard-store";
import { DashboardSkeleton } from "../ui/Skeleton";

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
  hasTransactions: boolean;
  /**
   * Demo mode (/demo): books come from `demoSnapshots` and every write stays
   * in memory — no API, no IndexedDB, no cookie.
   */
  isDemo?: boolean;
  /** Demo only: each seed book's snapshot, keyed by registry id. */
  demoSnapshots?: Record<string, RegistrySnapshot>;
  /** Laid over the content column (the demo mounts its tour button here). */
  children?: ReactNode;
}

export default function DashboardShell(props: DashboardShellProps) {
  const [state, dispatch] = useReducer(dashboardReducer, props, initialReducerArg);

  // Staleness guard for the async registry-switch flow (was `switchGen`).
  const switchGen = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [switching, setSwitching] = useState(false);

  // Demo: the last state of every book visited this session. A seed book
  // starts from its static snapshot and a book created in the demo starts
  // empty, but either way the book being left is stashed so switching back
  // restores it — the role the IndexedDB cache plays on the real dashboard.
  const demoVisited = useRef<Record<string, RegistrySnapshot | undefined>>({});

  /** Apply a registry snapshot after any await, unless a newer switch won. */
  function applySnapshot(snapshot: RegistrySnapshot) {
    dispatch({ type: "APPLY_SNAPSHOT", snapshot });
  }

  async function switchRegistry(id: string) {
    if (id === stateRef.current.registryId) return;

    if (props.isDemo) {
      const current = stateRef.current;
      demoVisited.current[current.registryId] = snapshotOf(current);
      dispatch({
        type: "APPLY_SNAPSHOT",
        snapshot: demoVisited.current[id] ??
          props.demoSnapshots?.[id] ?? {
            registryId: id,
            transactions: [],
            transactionPayments: [],
            balance: 0,
            balanceEntries: [],
            users: current.users.filter((u) => u.id === props.currentUserId),
            currentUserId: props.currentUserId,
            defaultSplit: null,
            spawnCandidates: [],
            entityIds: [],
            entities: [],
            lastModified: null,
          },
      });
      return;
    }

    const gen = ++switchGen.current;
    cache.setLastActiveRegistry(id).catch(() => {});

    const cached = await cache.getRegistrySnapshot(id);
    if (gen !== switchGen.current) return;

    if (cached && cached.transactions && cached.entities) {
      setSwitching(false);
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

    setSwitching(true);
    try {
      const res = await fetch(`/api/dashboard?registryId=${id}`, {
        cache: "no-store",
      });
      if (gen !== switchGen.current) return;
      if (!res.ok) throw new Error();
      const data = (await res.json()) as RegistrySnapshot;
      setSwitching(false);
      applyRegistrySwitch({ ...data, registryId: id });
    } catch {
      if (gen !== switchGen.current) return;
      setSwitching(false);
      globalThis.location.href = "/dashboard";
    }
  }

  function applyRegistrySwitch(snapshot: RegistrySnapshot) {
    applySnapshot(snapshot);
  }

  function handleEntitiesChanged(entities: Entity[]) {
    if (props.isDemo) {
      // `users` carries the terceros too (it is the list's participants), and
      // no server snapshot is coming to add one — refresh it from here.
      const { users, entityIds, registryId } = stateRef.current;
      dispatch({ type: "SET_ENTITIES", entities });
      dispatch({
        type: "APPLY_SNAPSHOT",
        snapshot: {
          registryId,
          users: [
            ...users.filter((u) => !entityIds.has(u.id)),
            ...entities.map(({ id, name, color }) => ({ id, name, color })),
          ],
        },
      });
      return;
    }
    dispatch({ type: "SET_ENTITIES", entities });
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
    // Demo books aren't the visitor's: cleaning orphans against them would
    // drop the cached snapshots of their real registries.
    if (props.isDemo) return;
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

  // The sidebar owns the mobile drawer; this is how a trigger rendered here
  // reaches it.
  const openMobileMenu = useRef<(() => void) | null>(null);
  const isStandalone = useIsStandalone();

  // On phones the demo's menu button sits beside the balance instead of
  // floating over the list. Only the demo header has the room: the regular one
  // also carries history, "Cortar" and the recurring button, which on a
  // 360px phone would leave the balance too little to show a typical amount.
  const menuInHeader = props.isDemo === true && hasMultipleParticipants;

  const balance = (
    <BalanceBreakdown
      balance={state.balance}
      entries={state.balanceEntries}
      users={state.users}
      locale={props.locale}
    />
  );

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
        onMobileMenu={props.isDemo ? (open) => (openMobileMenu.current = open) : undefined}
        floatingTrigger={!menuInHeader}
        isDemo={props.isDemo}
        onRegistrySwitch={switchRegistry}
        onEntitiesChanged={handleEntitiesChanged}
      />
      <div className="flex-1 flex flex-col min-w-0 relative">
        {switching ? (
          <DashboardSkeleton />
        ) : (
          <>
            {hasMultipleParticipants && (
              <header className="p-4 sm:p-6 bg-[#0a0a0a] border-b border-white/10 flex justify-between items-center gap-2">
                {menuInHeader ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <MobileMenuButton
                      inHeader
                      label={t(props.locale, "sidebar.menu")}
                      hidden={isStandalone}
                      onClick={() => openMobileMenu.current?.()}
                    />
                    {balance}
                  </div>
                ) : (
                  balance
                )}
                <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                  <RecurringSpawn
                    candidates={state.spawnCandidates}
                    registryId={state.registryId}
                    locale={props.locale}
                  />
                  {props.isDemo ? (
                    // No history or cut to offer here — a way back to the site instead.
                    <a
                      href="/"
                      className="p-3 bg-card hover:bg-white/5 transition-colors rounded-custom text-gray-300"
                      title={t(props.locale, "shell.home_title")}
                    >
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                    </a>
                  ) : (
                    <a
                      href="/dashboard/history"
                      className="p-3 bg-card hover:bg-white/5 transition-colors rounded-custom text-gray-300"
                      title={t(props.locale, "shell.history_title")}
                    >
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                    </a>
                  )}
                  <CortarButton
                    hasTransactions={props.hasTransactions}
                    registryId={state.registryId}
                    locale={props.locale}
                    isDemo={props.isDemo}
                  />
                </div>
              </header>
            )}
            <TransactionList
              state={state}
              dispatch={dispatch}
              isDemo={props.isDemo}
              locale={props.locale}
            />
          </>
        )}
        {props.children}
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

/** The store's state as a snapshot, so the same state can be re-applied later. */
function snapshotOf(state: DashboardState): RegistrySnapshot {
  return {
    registryId: state.registryId,
    transactions: state.transactions,
    transactionPayments: state.transactionPayments,
    balance: state.balance,
    balanceEntries: state.balanceEntries,
    users: state.users,
    currentUserId: state.currentUserId,
    defaultSplit: state.defaultSplit,
    spawnCandidates: state.spawnCandidates,
    entityIds: [...state.entityIds],
    entities: state.entities,
    lastModified: state.lastModified,
  };
}
