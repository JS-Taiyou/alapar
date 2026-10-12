import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import type {
  BalanceBreakdownEntry,
  DefaultSplit,
  Entity,
  Participant,
  Registry,
  SpawnCandidate,
  TransactionPayment,
  User,
} from "../lib/types";
import { cache } from "../lib/cache";
import { clearSupabaseBrowserStorage } from "./auth-storage";
import EntityManager from "./EntityManager";
import DefaultSplitConfig from "./DefaultSplitConfig";
import LocaleToggle from "./LocaleToggle";
import UpgradeButton from "./UpgradeButton";
import Modal from "../components/Modal";
import ProBadge from "../components/ProBadge";
import Toaster, { showUpgradeToast } from "./Toaster";
import {
  type EnrichedTransaction,
  entitiesChanged,
  registrySwitch,
  type RegistrySwitchPayload,
} from "./shared-signals";
import type { Locale } from "../lib/i18n";

interface SidebarProps {
  registries: Registry[];
  activeRegistryId: string;
  userName: string;
  userInitials: string;
  /** The current user's personal Pro status (drives the crown by the name). */
  userPro: User["pro"];
  isOwner: boolean;
  ownerRegistryIds: Set<string>;
  entities: Entity[];
  registryUsers: User[];
  defaultSplit: DefaultSplit | null;
  deletableRegistryIds: Set<string>;
  initialCollapsed?: boolean;
  locale?: Locale;
  /** Show the "Upgrade to Pro" CTA (free-plan active registry only). */
  showUpgrade?: boolean;
}

const REGISTRY_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#ef4444",
  "#14b8a6",
];

export default function Sidebar(props: SidebarProps) {
  const registries = useSignal(props.registries);
  const activeRegistryId = useSignal(props.activeRegistryId);
  const switchGen = useSignal(0);

  useSignalEffect(() => {
    if (typeof globalThis.indexedDB === "undefined") return;
    cache.cleanOrphanedEntries(props.registries.map((r) => r.id)).catch(
      () => {},
    );
    cache.getLastActiveRegistry().then((cachedId) => {
      if (
        cachedId && cachedId !== props.activeRegistryId &&
        props.registries.some((r) => r.id === cachedId)
      ) {
        switchRegistry(cachedId);
      }
    });
  });

  useSignalEffect(() => {
    const announcement = entitiesChanged.value;
    if (!announcement) return;
    if (announcement.entities) {
      $entities.value = announcement.entities;
      return;
    }
    const rid = activeRegistryId.value;
    if (!rid) return;
    fetch(`/api/entities?registryId=${rid}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) $entities.value = data as Entity[];
      })
      .catch(() => {
        // ignore
      });
  });

  const sortedRegistries = useComputed(() => {
    const active = activeRegistryId.value;
    const list = registries.value;
    const rest = list.filter((r) => r.id !== active).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const activeReg = list.find((r) => r.id === active);
    return activeReg ? [activeReg, ...rest] : rest;
  });
  const collapsed = useSignal(props.initialCollapsed ?? false);
  const mobileOpen = useSignal(false);
  const showInvite = useSignal(false);
  const isStandalone = useSignal(false);
  const dragOffset = useSignal<number | null>(null);
  const SIDEBAR_WIDTH = 288;
  const $entities = useSignal<Entity[]>([...props.entities]);
  const inviteLoading = useSignal(false);
  const inviteCode = useSignal("");
  const inviteError = useSignal("");
  const copied = useSignal(false);
  const renamingId = useSignal<string | null>(null);
  const renameValue = useSignal("");
  const showSplitConfig = useSignal<string | null>(null);
  const showNewRegistry = useSignal(false);
  const newRegistryName = useSignal("");
  const newRegistryLoading = useSignal(false);
  const newRegistryPendingId = useSignal<string | null>(null);

  useSignalEffect(() => {
    isStandalone.value =
      globalThis.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let twoFingerActive = false;
    let dragging = false;

    const SWIPE_THRESHOLD = 80;
    const MAX_VERTICAL_RATIO = 0.5;
    const SETTLE_RATIO = 0.4;

    function getX(e: TouchEvent): number {
      if (e.touches.length >= 2) {
        return (e.touches[0].clientX + e.touches[1].clientX) / 2;
      }
      return e.changedTouches.length > 0
        ? e.changedTouches[0].clientX
        : e.touches[0].clientX;
    }

    function getY(e: TouchEvent): number {
      if (e.touches.length >= 2) {
        return (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
      return e.changedTouches.length > 0
        ? e.changedTouches[0].clientY
        : e.touches[0].clientY;
    }

    function onTouchStart(e: TouchEvent) {
      if (globalThis.innerWidth >= 768) return;
      dragging = false;

      if (e.touches.length === 2) {
        twoFingerActive = true;
        touchStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        touchStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        touchStartTime = Date.now();
        dragging = true;
      } else if (e.touches.length === 1 && isStandalone.value) {
        twoFingerActive = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        dragging = true;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!dragging) return;
      if (globalThis.innerWidth >= 768) {
        dragging = false;
        dragOffset.value = null;
        return;
      }
      if (twoFingerActive && e.touches.length < 2) {
        dragging = false;
        dragOffset.value = null;
        return;
      }

      const currentX = getX(e);
      const currentY = getY(e);
      const dx = currentX - touchStartX;
      const dy = Math.abs(currentY - touchStartY);
      if (dy / (Math.abs(dx) + 1) > MAX_VERTICAL_RATIO) {
        dragging = false;
        dragOffset.value = null;
        return;
      }

      if (!mobileOpen.value) {
        if (dx > 0) {
          dragOffset.value = Math.min(dx, SIDEBAR_WIDTH);
        }
      } else {
        if (dx < 0) {
          dragOffset.value = SIDEBAR_WIDTH + Math.max(dx, -SIDEBAR_WIDTH);
        } else {
          dragOffset.value = SIDEBAR_WIDTH;
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!dragging) return;
      dragging = false;
      const isMobile = globalThis.innerWidth < 768;
      if (!isMobile) {
        dragOffset.value = null;
        return;
      }

      const dt = Date.now() - touchStartTime;
      const endX = getX(e);
      const endY = getY(e);
      const dx = endX - touchStartX;
      const dy = Math.abs(endY - touchStartY);

      twoFingerActive = false;

      if (dt > 800 || dy / (Math.abs(dx) + 1) > MAX_VERTICAL_RATIO) {
        dragOffset.value = null;
        return;
      }

      if (!mobileOpen.value) {
        const offset = dragOffset.value ?? 0;
        if (dx > SWIPE_THRESHOLD || offset > SIDEBAR_WIDTH * SETTLE_RATIO) {
          mobileOpen.value = true;
        }
      } else {
        const offset = dragOffset.value ?? SIDEBAR_WIDTH;
        if (
          dx < -SWIPE_THRESHOLD || offset < SIDEBAR_WIDTH * (1 - SETTLE_RATIO)
        ) {
          mobileOpen.value = false;
        }
      }

      dragOffset.value = null;
    }

    function onTouchCancel() {
      dragging = false;
      dragOffset.value = null;
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  });

  /** `/api/dashboard` response shape (fields we consume on switch). */
  type DashboardApiResponse = {
    transactions: EnrichedTransaction[];
    transactionPayments?: TransactionPayment[];
    balance: number;
    balanceEntries: BalanceBreakdownEntry[];
    users: Participant[];
    defaultSplit: DefaultSplit | null;
    spawnCandidates?: SpawnCandidate[];
    entityIds?: string[];
    entities?: Entity[];
    lastModified: string | null;
  };

  /**
   * Broadcast a registry snapshot to the transaction list (and keep our own
   * entity list in sync). One helper instead of one inline dispatch per
   * call site — the payload shape lives in shared-signals.ts, typed once.
   */
  function applyRegistrySwitch(payload: RegistrySwitchPayload) {
    registrySwitch.value = payload;
    if (payload.entities) $entities.value = payload.entities;
  }

  async function switchRegistry(id: string) {
    if (id === activeRegistryId.value) return;

    const gen = ++switchGen.value;
    cache.setLastActiveRegistry(id).catch(() => {});

    const cached = await cache.getRegistrySnapshot(id);
    if (gen !== switchGen.value) return;
    activeRegistryId.value = id;

    if (cached && cached.transactions && cached.entities) {
      // The IndexedDB snapshot is stored with `unknown[]` fields (its dates
      // are ISO strings); the transaction list re-coerces them on arrival.
      applyRegistrySwitch({
        registryId: id,
        transactions: cached.transactions as EnrichedTransaction[],
        transactionPayments: cached.transactionPayments as
          | TransactionPayment[]
          | undefined,
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
      if (gen !== switchGen.value) return;
      if (!res.ok) throw new Error();
      const data = await res.json() as DashboardApiResponse;

      applyRegistrySwitch({
        registryId: id,
        transactions: data.transactions,
        transactionPayments: data.transactionPayments,
        balance: data.balance,
        balanceEntries: data.balanceEntries,
        users: data.users,
        defaultSplit: data.defaultSplit,
        spawnCandidates: data.spawnCandidates ?? [],
        entityIds: data.entityIds ?? [],
        entities: data.entities ?? [],
        lastModified: data.lastModified,
      });
    } catch {
      if (gen !== switchGen.value) return;
      globalThis.location.href = "/dashboard";
    }
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
      if (gen !== switchGen.value) return;
      if (!stampRes.ok) return;
      const { lastModified } = await stampRes.json() as {
        lastModified: string | null;
      };

      // Null stamp = version unknown → always refetch, never "in sync".
      if (lastModified && lastModified === cachedLastModified) return;

      const dashRes = await fetch(`/api/dashboard?registryId=${registryId}`, {
        cache: "no-store",
      });
      if (gen !== switchGen.value) return;
      if (!dashRes.ok) return;
      const data = await dashRes.json() as DashboardApiResponse;

      applyRegistrySwitch({
        registryId,
        transactions: data.transactions,
        transactionPayments: data.transactionPayments,
        balance: data.balance,
        balanceEntries: data.balanceEntries,
        users: data.users,
        defaultSplit: data.defaultSplit,
        spawnCandidates: data.spawnCandidates ?? [],
        entityIds: data.entityIds ?? [],
        entities: data.entities ?? [],
        lastModified,
      });
    } catch { /* background validation failure is non-critical */ }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Server unreachable — proceed with client-side cleanup anyway.
    }
    // Drop every cached response so nothing authenticated lingers on a
    // shared device. Done from the page directly (the Cache API is available
    // to window contexts) and via the service worker's CLEAR_CACHES handler
    // as a belt-and-braces backup.
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      const reg = await navigator.serviceWorker?.getRegistration();
      reg?.active?.postMessage({ type: "CLEAR_CACHES" });
    } catch {
      // Cache/SW APIs unavailable — nothing more to clear.
    }
    // IndexedDB registry snapshots hold transaction data — drop them too.
    cache.clearAll().catch(() => {});
    // Defensive: no auth artifacts should be in localStorage, but wipe any
    // leftovers (e.g. from older builds) before leaving.
    clearSupabaseBrowserStorage();
    globalThis.location.href = "/login";
  }

  async function handleCreateInvite() {
    inviteLoading.value = true;
    inviteError.value = "";
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: activeRegistryId.value }),
      });
      const data = await res.json();
      if (data.code) {
        inviteCode.value = data.code;
      } else {
        inviteError.value = data.error || "Error al crear invitación";
      }
    } catch {
      inviteError.value = "Error de conexión";
    }
    inviteLoading.value = false;
  }

  function copyCode() {
    navigator.clipboard
      .writeText(`${globalThis.location.origin}/join/${inviteCode.value}`)
      .then(() => {
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 2000);
      })
      .catch(() => {
        // Permission denied — show nothing rather than a false "Copiado!"
      });
  }

  function closeInviteModal() {
    showInvite.value = false;
    inviteCode.value = "";
    inviteError.value = "";
    copied.value = false;
  }

  function startRename(id: string, currentName: string) {
    renamingId.value = id;
    renameValue.value = currentName;
  }

  async function confirmRename(id: string) {
    const name = renameValue.value.trim();
    if (!name) {
      renamingId.value = null;
      return;
    }
    const original = registries.value.find((r) => r.id === id)?.name ?? "";
    if (name === original) {
      renamingId.value = null;
      return;
    }
    const oldRegistries = registries.value;
    registries.value = registries.value.map((r) =>
      r.id === id ? { ...r, name } : r
    );
    renamingId.value = null;
    try {
      const res = await fetch(`/api/registries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) registries.value = oldRegistries;
    } catch {
      registries.value = oldRegistries;
    }
  }

  async function handleDeleteRegistry(id: string) {
    if (!confirm("Eliminar este registro? Esta acción no se puede deshacer.")) {
      return;
    }
    let res: Response;
    try {
      res = await fetch(`/api/registries/${id}`, { method: "DELETE" });
    } catch {
      return; // offline — nothing was deleted, nothing to update
    }
    if (res.status === 409) {
      alert("No se puede eliminar un registro con transacciones.");
      return;
    }
    if (!res.ok) return;

    registries.value = registries.value.filter((r) => r.id !== id);
    cache.invalidateRegistry(id).catch(() => {});

    if (activeRegistryId.value === id) {
      const remaining = registries.value;
      if (remaining.length > 0) {
        switchRegistry(remaining[0].id);
      } else {
        globalThis.location.href = "/";
      }
    }
  }

  async function handleCreateRegistry() {
    const name = newRegistryName.value.trim();
    if (!name || newRegistryLoading.value) return;

    const tempId = crypto.randomUUID();
    newRegistryLoading.value = true;
    newRegistryPendingId.value = tempId;

    registries.value = [
      ...registries.value,
      {
        id: tempId,
        name,
        isDefault: false,
        latestAccessed: new Date(),
        defaultSplit: null,
        defaultSplitMemberCount: null,
        lastModified: null,
      },
    ];

    showNewRegistry.value = false;
    newRegistryName.value = "";

    try {
      const res = await fetch("/api/registries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 402) {
        // Free-plan owned-registry cap: the optimistic row rolls back below;
        // the toast carries the limit message plus a path to /pricing.
        showUpgradeToast(props.locale ?? "es", "billing.registries_full");
      }
      if (!res.ok) throw new Error("create failed");
      const { registry } = await res.json() as { registry: Registry };
      registries.value = registries.value.map((r) =>
        r.id === tempId ? registry : r
      );
      newRegistryPendingId.value = null;

      cache.setRegistrySnapshot({
        registryId: registry.id,
        transactions: [],
        transactionPayments: [],
        balance: 0,
        balanceEntries: [],
        users: [],
        currentUserId: "",
        defaultSplit: null,
        spawnCandidates: [],
        entityIds: [],
        entities: [],
        lastModified: null,
      }).catch(() => {});
    } catch {
      registries.value = registries.value.filter((r) => r.id !== tempId);
    } finally {
      newRegistryLoading.value = false;
    }
  }

  const sidebarContent = (
    <>
      <div
        class={`border-b border-white/10 flex items-center transition-all duration-300 ${
          collapsed.value && !mobileOpen.value
            ? "p-1.5 justify-center"
            : "p-4 justify-between"
        }`}
      >
        <div
          class={`flex items-center gap-3 min-w-0 transition-opacity duration-200 overflow-hidden ${
            collapsed.value && !mobileOpen.value
              ? "opacity-0 w-0"
              : "opacity-100"
          }`}
        >
          <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center font-bold text-white shrink-0">
            {props.userInitials}
          </div>
          <div class="flex flex-col min-w-0 whitespace-nowrap">
            <span class="text-sm font-semibold text-white truncate flex items-center gap-1.5">
              {props.userName}
              <ProBadge pro={props.userPro} locale={props.locale} size="md" />
            </span>
            <span class="text-xs text-zinc-400">A la par</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (globalThis.innerWidth < 768) {
              mobileOpen.value = false;
            } else {
              collapsed.value = !collapsed.value;
              document.cookie =
                `sidebar-collapsed=${collapsed.value};path=/;max-age=${
                  60 * 60 * 24 * 365
                };samesite=lax`;
            }
          }}
          class={`hover:bg-white/10 rounded-custom text-zinc-400 hover:text-white transition-all duration-300 shrink-0 hidden md:flex items-center justify-center bg-white/5 border border-white/10 ${
            collapsed.value && !mobileOpen.value ? "p-2.5 w-full" : "p-2.5"
          }`}
        >
          <svg
            class="w-5 h-5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {collapsed.value
              ? (
                <path
                  d="M13 5l7 7-7 7M5 5l7 7-7 7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              )
              : (
                <path
                  d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              )}
          </svg>
        </button>
      </div>
      <div
        class={`flex-1 overflow-hidden space-y-2 transition-all duration-300 ${
          collapsed.value && !mobileOpen.value
            ? "p-1.5"
            : "p-4 overflow-y-auto custom-scrollbar"
        }`}
      >
        <h3
          class={`px-2 text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 whitespace-nowrap transition-opacity duration-200 ${
            collapsed.value && !mobileOpen.value
              ? "opacity-0 h-0"
              : "opacity-100"
          }`}
        >
          Registros
        </h3>
        {sortedRegistries.value.map((r, i) => {
          const isPending = r.id === newRegistryPendingId.value;
          const isOwnedByMe = isPending || props.ownerRegistryIds.has(r.id);
          const isDeletable = isPending ||
            props.deletableRegistryIds.has(r.id);
          return (
            <div key={r.id} class="group relative">
              {renamingId.value === r.id
                ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      confirmRename(r.id);
                    }}
                    class={`w-full flex items-center rounded-custom ${
                      collapsed.value && !mobileOpen.value
                        ? "justify-center p-2.5"
                        : "gap-3 px-3 py-2.5"
                    } bg-white/5 border border-white/10 text-white`}
                  >
                    <div
                      class="w-2 h-2 rounded-full flex-shrink-0"
                      style={`background-color: ${
                        REGISTRY_COLORS[i % REGISTRY_COLORS.length]
                      }`}
                    />
                    <input
                      type="text"
                      value={renameValue.value}
                      onInput={(e) =>
                        renameValue.value =
                          (e.target as HTMLInputElement).value}
                      onBlur={() => confirmRename(r.id)}
                      class={`flex-1 min-w-0 bg-white/5 border border-white/10 rounded text-sm font-medium text-white p-1 px-2 focus:outline-none focus:ring-1 focus:ring-white/20 ${
                        collapsed.value && !mobileOpen.value
                          ? "opacity-0 w-0 p-0"
                          : ""
                      }`}
                      autofocus
                    />
                  </form>
                )
                : (
                  <button
                    type="button"
                    onClick={() => !isPending && switchRegistry(r.id)}
                    disabled={isPending}
                    class={`w-full flex items-center rounded-custom transition-all duration-300 ${
                      collapsed.value && !mobileOpen.value
                        ? "justify-center p-2.5"
                        : "gap-3 px-3 py-2.5"
                    } ${
                      isPending
                        ? "bg-primary/10 border border-primary/30 text-primary"
                        : collapsed.value && !mobileOpen.value
                        ? ""
                        : r.id === activeRegistryId.value
                        ? "bg-white/5 border border-white/10 text-white"
                        : "border border-transparent hover:bg-white/5 hover:border-white/10 text-zinc-300 hover:text-white"
                    }`}
                    style={collapsed.value && !mobileOpen.value && !isPending
                      ? `background-color: ${
                        REGISTRY_COLORS[i % REGISTRY_COLORS.length]
                      }20; border: 1px solid ${
                        REGISTRY_COLORS[i % REGISTRY_COLORS.length]
                      }40`
                      : undefined}
                    title={r.name}
                  >
                    <div
                      class="rounded-full flex-shrink-0 transition-all duration-300 w-2 h-2"
                      style={collapsed.value && !mobileOpen.value
                        ? undefined
                        : `background-color: ${
                          REGISTRY_COLORS[i % REGISTRY_COLORS.length]
                        }`}
                    />
                    <span
                      class={`text-sm font-medium truncate min-w-0 whitespace-nowrap transition-all duration-200 flex items-center ${
                        collapsed.value && !mobileOpen.value
                          ? "opacity-0 w-0 overflow-hidden"
                          : "opacity-100 flex-1 text-left"
                      }`}
                    >
                      {r.name}
                      {isPending && (
                        <svg
                          class="w-3.5 h-3.5 ml-2 animate-spin text-primary shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            class="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            stroke-width="4"
                          />
                          <path
                            class="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      )}
                    </span>
                    <span
                      style="opacity:0"
                      class={`sidebar-action-btns items-center gap-1.5 flex-shrink-0 transition-opacity duration-200 ${
                        collapsed.value && !mobileOpen.value
                          ? "w-0 overflow-hidden hidden"
                          : "flex"
                      }`}
                    >
                      {isOwnedByMe && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(r.id, r.name);
                          }}
                          class="p-2 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors"
                          title="Renombrar"
                        >
                          <svg
                            class="w-4.5 h-4.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                        </button>
                      )}
                      {isOwnedByMe && !isPending && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            showSplitConfig.value = r.id;
                          }}
                          class="p-2 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors text-sm font-bold"
                          title="División Default"
                        >
                          %
                        </button>
                      )}
                      {isOwnedByMe && isDeletable && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRegistry(r.id);
                          }}
                          class="p-2 hover:bg-red-500/20 rounded text-zinc-400 hover:text-red-400 transition-colors"
                          title="Eliminar"
                        >
                          <svg
                            class="w-4.5 h-4.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                        </button>
                      )}
                    </span>
                  </button>
                )}
            </div>
          );
        })}
      </div>

      {props.isOwner && activeRegistryId.value && (
        <div
          class={`transition-all duration-300 ${
            collapsed.value && !mobileOpen.value ? "px-1.5 pb-1.5" : "px-4 pb-2"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              showInvite.value = true;
            }}
            class={`w-full flex items-center bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-custom text-sm font-semibold text-emerald-400 transition-all duration-300 ${
              collapsed.value && !mobileOpen.value
                ? "justify-center p-2.5"
                : "justify-center gap-2 py-2.5 px-3"
            }`}
          >
            <svg
              class="w-5 h-5 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            <span
              class={`whitespace-nowrap transition-opacity duration-200 ${
                collapsed.value && !mobileOpen.value
                  ? "opacity-0 w-0 overflow-hidden"
                  : "opacity-100"
              }`}
            >
              Invitar
            </span>
          </button>
        </div>
      )}

      {activeRegistryId.value && (
        <div
          class={`transition-all duration-300 ${
            collapsed.value && !mobileOpen.value ? "px-1.5 pb-1.5" : "px-4 pb-2"
          }`}
        >
          <div
            class={`transition-opacity duration-200 ${
              collapsed.value && !mobileOpen.value
                ? "opacity-0 h-0 overflow-hidden"
                : "opacity-100"
            }`}
          >
            <EntityManager
              registryId={activeRegistryId.value}
              entities={$entities}
            />
          </div>
          {collapsed.value && !mobileOpen.value && (
            <button
              type="button"
              onClick={() => {
                if (globalThis.innerWidth < 768) {
                  mobileOpen.value = true;
                } else {
                  collapsed.value = false;
                }
              }}
              class="w-full flex items-center justify-center p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-white"
              title="Terceros"
            >
              <svg
                class="w-5 h-5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      <div
        class={`border-t border-white/10 space-y-2 transition-all duration-300 ${
          collapsed.value && !mobileOpen.value ? "p-1.5" : "p-4"
        }`}
      >
        <button
          type="button"
          onClick={() => showNewRegistry.value = true}
          class={`w-full flex items-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-white transition-all duration-300 ${
            collapsed.value && !mobileOpen.value
              ? "justify-center p-2.5"
              : "justify-center gap-2 py-3 px-4"
          }`}
        >
          <svg
            class="w-5 h-5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 4v16m8-8H4"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
          <span
            class={`whitespace-nowrap transition-opacity duration-200 ${
              collapsed.value && !mobileOpen.value
                ? "opacity-0 w-0 overflow-hidden"
                : "opacity-100"
            }`}
          >
            Nuevo Registro
          </span>
        </button>
        {props.showUpgrade && props.activeRegistryId && (
          <UpgradeButton locale={props.locale ?? "es"} />
        )}
        {(!collapsed.value || mobileOpen.value) && (
          <LocaleToggle locale={props.locale ?? "es"} full class="my-1" />
        )}
        <button
          type="button"
          onClick={handleLogout}
          class={`w-full flex items-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-zinc-400 hover:text-red-400 transition-all duration-300 ${
            collapsed.value && !mobileOpen.value
              ? "justify-center p-2.5"
              : "justify-center gap-2 py-2.5 px-4"
          }`}
        >
          <svg
            class="w-4 h-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
          <span
            class={`whitespace-nowrap transition-opacity duration-200 ${
              collapsed.value && !mobileOpen.value
                ? "opacity-0 w-0 overflow-hidden"
                : "opacity-100"
            }`}
          >
            Cerrar sesión
          </span>
        </button>
      </div>
    </>
  );

  return (
    <>
      <Toaster />
      <button
        type="button"
        onClick={() => mobileOpen.value = true}
        class={`md:hidden fixed bottom-20 left-4 z-40 w-12 h-12 bg-surface border border-border-custom rounded-full text-white shadow-lg flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all ${
          isStandalone.value ? "hidden" : ""
        }`}
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </svg>
      </button>

      {(mobileOpen.value || dragOffset.value !== null) && (
        <div
          class="md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-300"
          style={dragOffset.value !== null
            ? { opacity: (dragOffset.value / SIDEBAR_WIDTH) * 0.6 }
            : undefined}
          onClick={() => {
            mobileOpen.value = false;
            dragOffset.value = null;
          }}
        />
      )}

      <aside
        class={`hidden md:flex ${
          collapsed.value ? "w-16" : "w-72"
        } bg-[#0a0a0a] border-r border-white/10 flex-col h-full overflow-hidden transition-[width] duration-300`}
      >
        {sidebarContent}
      </aside>

      <aside
        class={`md:hidden fixed top-0 left-0 z-50 w-72 bg-[#0a0a0a] border-r border-white/10 flex flex-col h-full ${
          dragOffset.value !== null
            ? "transition-none"
            : "transition-transform duration-300"
        }`}
        style={{
          transform: `translateX(${
            dragOffset.value !== null
              ? `${dragOffset.value - SIDEBAR_WIDTH}px`
              : mobileOpen.value
              ? "0"
              : "-100%"
          })`,
        }}
      >
        <div class="flex items-center justify-between p-4 border-b border-white/10">
          <span class="text-lg font-bold text-white">Menu</span>
          <button
            type="button"
            onClick={() => mobileOpen.value = false}
            class="p-2 hover:bg-white/5 rounded-custom text-zinc-400"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M6 18L18 6M6 6l12 12"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </button>
        </div>
        {sidebarContent}
      </aside>

      {showInvite.value && (
        <Modal
          onClose={closeInviteModal}
          title="Invitar al Registro"
          subtitle="Genera un código para invitar a alguien"
          footer={
            <div class="ml-auto">
              <button
                type="button"
                onClick={closeInviteModal}
                class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cerrar
              </button>
            </div>
          }
        >
          <div class="p-6 space-y-4">
            {!inviteCode.value
              ? (
                <button
                  type="button"
                  onClick={handleCreateInvite}
                  disabled={inviteLoading.value}
                  class="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all active:scale-95 disabled:opacity-50"
                >
                  {inviteLoading.value
                    ? "Generando..."
                    : "Generar Código de Invitación"}
                </button>
              )
              : (
                <div class="space-y-3">
                  <div class="text-center">
                    <p class="text-sm text-zinc-400 mb-2">
                      Código de invitación:
                    </p>
                    <div class="flex items-center justify-center gap-2">
                      <span class="text-3xl font-mono font-bold text-white tracking-widest">
                        {inviteCode.value}
                      </span>
                      <button
                        type="button"
                        onClick={copyCode}
                        class="p-2 hover:bg-white/10 rounded-custom text-primary transition-colors"
                        title="Copiar"
                      >
                        <svg
                          class="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                          />
                        </svg>
                      </button>
                    </div>
                    {copied.value && (
                      <p class="text-xs text-emerald-400 mt-1">Copiado!</p>
                    )}
                  </div>
                  <p class="text-xs text-zinc-500 text-center">
                    Comparte este código o el enlace:{" "}
                    {globalThis.location.origin}/join/{inviteCode.value}
                  </p>
                </div>
              )}
            {inviteError.value && (
              <p class="text-sm text-red-300">{inviteError.value}</p>
            )}
          </div>
        </Modal>
      )}

      {showNewRegistry.value && (
        <Modal
          onClose={() => showNewRegistry.value = false}
          title="Nuevo Registro"
          subtitle="Crea un grupo para gestionar gastos compartidos"
          footer={
            <>
              <button
                type="button"
                onClick={() => showNewRegistry.value = false}
                class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateRegistry}
                disabled={!newRegistryName.value.trim() ||
                  newRegistryLoading.value}
                class="px-8 py-2 text-sm font-semibold bg-primary hover:bg-primary-light text-white rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                Crear
              </button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateRegistry();
            }}
            class="p-6"
          >
            <input
              type="text"
              value={newRegistryName.value}
              onInput={(e) =>
                newRegistryName.value = (e.target as HTMLInputElement).value}
              placeholder="Ej: Compañeros de piso"
              class="block w-full px-4 py-2.5 bg-background border border-border-custom rounded-custom text-white focus:ring-primary focus:border-primary"
              autofocus
            />
          </form>
        </Modal>
      )}

      {showSplitConfig.value && (
        <DefaultSplitConfig
          registryId={showSplitConfig.value}
          users={props.registryUsers}
          defaultSplit={registries.value.find((r) =>
            r.id === showSplitConfig.value
          )?.defaultSplit ?? null}
          isOwner={props.ownerRegistryIds.has(showSplitConfig.value)}
          autoOpen
          locale={props.locale}
          onClose={() => showSplitConfig.value = null}
        />
      )}
    </>
  );
}
