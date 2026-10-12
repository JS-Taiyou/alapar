/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DefaultSplit, Entity, Registry, User } from "../../lib/types";
import { cache } from "../../lib/cache";
import { clearSupabaseBrowserStorage } from "../../lib/auth-storage";
import EntityManager from "./EntityManager";
import DefaultSplitConfig from "./DefaultSplitConfig";
import LocaleToggle from "../ui/LocaleToggle";
import UpgradeButton from "../ui/UpgradeButton";
import Modal from "../ui/Modal";
import ProBadge from "../ui/ProBadge";
import { showUpgradeToast } from "../ui/toast-store";
import type { Locale } from "../../lib/i18n";

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
  /**
   * Registry switch, owned by the dashboard shell (cache + fetch + state
   * apply). Absent on server-rendered pages (history): switching there
   * records the choice and lands on /dashboard instead.
   */
  onRegistrySwitch?: (id: string) => void;
  /** Entity-list updates propagated to the owning store (shell mode only). */
  onEntitiesChanged?: (entities: Entity[]) => void;
}

const REGISTRY_COLORS = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#14b8a6"];

export default function Sidebar(props: SidebarProps) {
  const [registries, setRegistries] = useState(props.registries);
  const [collapsed, setCollapsed] = useState(props.initialCollapsed ?? false);
  const [mobileOpen, setMobileOpenState] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dragOffset, setDragOffsetState] = useState<number | null>(null);
  const SIDEBAR_WIDTH = 288;

  // Local entity-list mirror: seeded from props (the shell's store, or the
  // server render on standalone pages) and kept fresh through the
  // EntityManager announcements below.
  const [entityList, setEntityList] = useState(props.entities);
  useEffect(() => {
    setEntityList(props.entities);
  }, [props.entities]);

  function handleEntitiesChanged(announcement: Entity[] | null) {
    if (announcement) {
      setEntityList(announcement);
      props.onEntitiesChanged?.(announcement);
      return;
    }
    // The post-mutation refetch itself failed — try once more from here.
    const rid = activeRegistryId;
    if (!rid) return;
    fetch(`/api/entities?registryId=${rid}`)
      .then((res) => (res.ok ? (res.json() as Promise<Entity[]>) : null))
      .then((data) => {
        if (!data) return;
        setEntityList(data);
        props.onEntitiesChanged?.(data);
      })
      .catch(() => {
        // ignore
      });
  }

  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [copied, setCopied] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showSplitConfig, setShowSplitConfig] = useState<string | null>(null);
  const [showNewRegistry, setShowNewRegistry] = useState(false);
  const [newRegistryName, setNewRegistryName] = useState("");
  const [newRegistryLoading, setNewRegistryLoading] = useState(false);
  const [newRegistryPendingId, setNewRegistryPendingId] = useState<string | null>(null);

  // The touch handlers below read/write these from long-lived listeners;
  // refs keep the listeners current without re-registering them.
  const mobileOpenRef = useRef(mobileOpen);
  function setMobileOpen(v: boolean) {
    mobileOpenRef.current = v;
    setMobileOpenState(v);
  }
  const dragOffsetRef = useRef<number | null>(null);
  function setDragOffset(v: number | null) {
    dragOffsetRef.current = v;
    setDragOffsetState(v);
  }

  const switchRegistry = props.onRegistrySwitch
    ? props.onRegistrySwitch
    : (id: string) => {
        // Standalone sidebar (server-rendered pages): remember the choice and
        // land on the dashboard, whose shell picks the registry up.
        cache.setLastActiveRegistry(id).catch(() => {});
        globalThis.location.assign("/dashboard");
      };

  const activeRegistryId = props.activeRegistryId;

  useEffect(() => {
    const standalone =
      globalThis.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

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
      return e.changedTouches.length > 0 ? e.changedTouches[0].clientX : e.touches[0].clientX;
    }

    function getY(e: TouchEvent): number {
      if (e.touches.length >= 2) {
        return (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
      return e.changedTouches.length > 0 ? e.changedTouches[0].clientY : e.touches[0].clientY;
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
      } else if (e.touches.length === 1 && standalone) {
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
        setDragOffset(null);
        return;
      }
      if (twoFingerActive && e.touches.length < 2) {
        dragging = false;
        setDragOffset(null);
        return;
      }

      const currentX = getX(e);
      const currentY = getY(e);
      const dx = currentX - touchStartX;
      const dy = Math.abs(currentY - touchStartY);
      if (dy / (Math.abs(dx) + 1) > MAX_VERTICAL_RATIO) {
        dragging = false;
        setDragOffset(null);
        return;
      }

      if (!mobileOpenRef.current) {
        if (dx > 0) {
          setDragOffset(Math.min(dx, SIDEBAR_WIDTH));
        }
      } else {
        if (dx < 0) {
          setDragOffset(SIDEBAR_WIDTH + Math.max(dx, -SIDEBAR_WIDTH));
        } else {
          setDragOffset(SIDEBAR_WIDTH);
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!dragging) return;
      dragging = false;
      const isMobile = globalThis.innerWidth < 768;
      if (!isMobile) {
        setDragOffset(null);
        return;
      }

      const dt = Date.now() - touchStartTime;
      const endX = getX(e);
      const endY = getY(e);
      const dx = endX - touchStartX;
      const dy = Math.abs(endY - touchStartY);

      twoFingerActive = false;

      if (dt > 800 || dy / (Math.abs(dx) + 1) > MAX_VERTICAL_RATIO) {
        setDragOffset(null);
        return;
      }

      if (!mobileOpenRef.current) {
        const offset = dragOffsetRef.current ?? 0;
        if (dx > SWIPE_THRESHOLD || offset > SIDEBAR_WIDTH * SETTLE_RATIO) {
          setMobileOpen(true);
        }
      } else {
        const offset = dragOffsetRef.current ?? SIDEBAR_WIDTH;
        if (dx < -SWIPE_THRESHOLD || offset < SIDEBAR_WIDTH * (1 - SETTLE_RATIO)) {
          setMobileOpen(false);
        }
      }

      setDragOffset(null);
    }

    function onTouchCancel() {
      dragging = false;
      setDragOffset(null);
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
  }, []);

  const sortedRegistries = useMemo(() => {
    const active = activeRegistryId;
    const list = registries;
    const rest = list.filter((r) => r.id !== active).sort((a, b) => a.name.localeCompare(b.name));
    const activeReg = list.find((r) => r.id === active);
    return activeReg ? [activeReg, ...rest] : rest;
  }, [registries, activeRegistryId]);

  /** `/api/dashboard` response shape (fields we consume on switch). */
  type DashboardApiResponse = {
    transactions: unknown[];
    transactionPayments?: unknown[];
    balance: number;
    balanceEntries: unknown[];
    users: unknown[];
    defaultSplit: DefaultSplit | null;
    spawnCandidates?: unknown[];
    entityIds?: string[];
    entities?: Entity[];
    lastModified: string | null;
  };

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
    setInviteLoading(true);
    setInviteError("");
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: activeRegistryId }),
      });
      const data = await res.json();
      if (data.code) {
        setInviteCode(data.code);
      } else {
        setInviteError(data.error || "Error al crear invitación");
      }
    } catch {
      setInviteError("Error de conexión");
    }
    setInviteLoading(false);
  }

  function copyCode() {
    navigator.clipboard
      .writeText(`${globalThis.location.origin}/join/${inviteCode}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      })
      .catch(() => {
        // Permission denied — show nothing rather than a false "Copiado!"
      });
  }

  function closeInviteModal() {
    setShowInvite(false);
    setInviteCode("");
    setInviteError("");
    setCopied(false);
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id);
    setRenameValue(currentName);
  }

  async function confirmRename(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    const original = registries.find((r) => r.id === id)?.name ?? "";
    if (name === original) {
      setRenamingId(null);
      return;
    }
    const oldRegistries = registries;
    setRegistries(registries.map((r) => (r.id === id ? { ...r, name } : r)));
    setRenamingId(null);
    try {
      const res = await fetch(`/api/registries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) setRegistries(oldRegistries);
    } catch {
      setRegistries(oldRegistries);
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

    setRegistries((prev) => prev.filter((r) => r.id !== id));
    cache.invalidateRegistry(id).catch(() => {});

    if (activeRegistryId === id) {
      const remaining = registries.filter((r) => r.id !== id);
      if (remaining.length > 0) {
        switchRegistry(remaining[0].id);
      } else {
        globalThis.location.href = "/";
      }
    }
  }

  async function handleCreateRegistry() {
    const name = newRegistryName.trim();
    if (!name || newRegistryLoading) return;

    const tempId = crypto.randomUUID();
    setNewRegistryLoading(true);
    setNewRegistryPendingId(tempId);

    setRegistries((prev) => [
      ...prev,
      {
        id: tempId,
        name,
        isDefault: false,
        latestAccessed: new Date(),
        defaultSplit: null,
        defaultSplitMemberCount: null,
        lastModified: null,
      },
    ]);

    setShowNewRegistry(false);
    setNewRegistryName("");

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
      const { registry } = (await res.json()) as { registry: Registry };
      setRegistries((prev) => prev.map((r) => (r.id === tempId ? registry : r)));
      setNewRegistryPendingId(null);

      cache
        .setRegistrySnapshot({
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
        })
        .catch(() => {});
    } catch {
      setRegistries((prev) => prev.filter((r) => r.id !== tempId));
    } finally {
      setNewRegistryLoading(false);
    }
  }

  const sidebarContent = (
    <>
      <div
        className={`border-b border-white/10 flex items-center transition-all duration-300 ${
          collapsed && !mobileOpen ? "p-1.5 justify-center" : "p-4 justify-between"
        }`}
      >
        <div
          className={`flex items-center gap-3 min-w-0 transition-opacity duration-200 overflow-hidden ${
            collapsed && !mobileOpen ? "opacity-0 w-0" : "opacity-100"
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center font-bold text-white shrink-0">
            {props.userInitials}
          </div>
          <div className="flex flex-col min-w-0 whitespace-nowrap">
            <span className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
              {props.userName}
              <ProBadge pro={props.userPro} locale={props.locale} size="md" />
            </span>
            <span className="text-xs text-zinc-400">A la par</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (globalThis.innerWidth < 768) {
              setMobileOpen(false);
            } else {
              setCollapsed(!collapsed);
              document.cookie = `sidebar-collapsed=${collapsed};path=/;max-age=${
                60 * 60 * 24 * 365
              };samesite=lax`;
            }
          }}
          className={`hover:bg-white/10 rounded-custom text-zinc-400 hover:text-white transition-all duration-300 shrink-0 hidden md:flex items-center justify-center bg-white/5 border border-white/10 ${
            collapsed && !mobileOpen ? "p-2.5 w-full" : "p-2.5"
          }`}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {collapsed ? (
              <path
                d="M13 5l7 7-7 7M5 5l7 7-7 7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            ) : (
              <path
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            )}
          </svg>
        </button>
      </div>
      <div
        className={`flex-1 overflow-hidden space-y-2 transition-all duration-300 ${
          collapsed && !mobileOpen ? "p-1.5" : "p-4 overflow-y-auto custom-scrollbar"
        }`}
      >
        <h3
          className={`px-2 text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 whitespace-nowrap transition-opacity duration-200 ${
            collapsed && !mobileOpen ? "opacity-0 h-0" : "opacity-100"
          }`}
        >
          Registros
        </h3>
        {sortedRegistries.map((r, i) => {
          const isPending = r.id === newRegistryPendingId;
          const isOwnedByMe = isPending || props.ownerRegistryIds.has(r.id);
          const isDeletable = isPending || props.deletableRegistryIds.has(r.id);
          return (
            <div key={r.id} className="group relative">
              {renamingId === r.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    confirmRename(r.id);
                  }}
                  className={`w-full flex items-center rounded-custom ${
                    collapsed && !mobileOpen
                      ? "justify-center p-2.5"
                      : "gap-3 px-3 py-2.5"
                  } bg-white/5 border border-white/10 text-white`}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: REGISTRY_COLORS[i % REGISTRY_COLORS.length] }}
                  />
                  <input
                    type="text"
                    value={renameValue}
                    onInput={(e) => setRenameValue(e.currentTarget.value)}
                    onBlur={() => confirmRename(r.id)}
                    className={`flex-1 min-w-0 bg-white/5 border border-white/10 rounded text-sm font-medium text-white p-1 px-2 focus:outline-none focus:ring-1 focus:ring-white/20 ${
                      collapsed && !mobileOpen ? "opacity-0 w-0 p-0" : ""
                    }`}
                    autoFocus
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => !isPending && switchRegistry(r.id)}
                  disabled={isPending}
                  className={`w-full flex items-center rounded-custom transition-all duration-300 ${
                    collapsed && !mobileOpen
                      ? "justify-center p-2.5"
                      : "gap-3 px-3 py-2.5"
                  } ${
                    isPending
                      ? "bg-primary/10 border border-primary/30 text-primary"
                      : collapsed && !mobileOpen
                        ? ""
                        : r.id === activeRegistryId
                          ? "bg-white/5 border border-white/10 text-white"
                          : "border border-transparent hover:bg-white/5 hover:border-white/10 text-zinc-300 hover:text-white"
                  }`}
                  style={
                    collapsed && !mobileOpen && !isPending
                      ? {
                          backgroundColor: `${REGISTRY_COLORS[i % REGISTRY_COLORS.length]}20`,
                          border: `1px solid ${REGISTRY_COLORS[i % REGISTRY_COLORS.length]}40`,
                        }
                      : undefined
                  }
                  title={r.name}
                >
                  <div
                    className="rounded-full flex-shrink-0 transition-all duration-300 w-2 h-2"
                    style={
                      collapsed && !mobileOpen
                        ? undefined
                        : { backgroundColor: REGISTRY_COLORS[i % REGISTRY_COLORS.length] }
                    }
                  />
                  <span
                    className={`text-sm font-medium truncate min-w-0 whitespace-nowrap transition-all duration-200 flex items-center ${
                      collapsed && !mobileOpen
                        ? "opacity-0 w-0 overflow-hidden"
                        : "opacity-100 flex-1 text-left"
                    }`}
                  >
                    {r.name}
                    {isPending && (
                      <svg
                        className="w-3.5 h-3.5 ml-2 animate-spin text-primary shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    )}
                  </span>
                  <span
                    style={{ opacity: 0 }}
                    className={`sidebar-action-btns items-center gap-1.5 flex-shrink-0 transition-opacity duration-200 ${
                      collapsed && !mobileOpen ? "w-0 overflow-hidden hidden" : "flex"
                    }`}
                  >
                    {isOwnedByMe && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(r.id, r.name);
                        }}
                        className="p-2 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors"
                        title="Renombrar"
                      >
                        <svg
                          className="w-4.5 h-4.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                          />
                        </svg>
                      </button>
                    )}
                    {isOwnedByMe && !isPending && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowSplitConfig(r.id);
                        }}
                        className="p-2 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors text-sm font-bold"
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
                        className="p-2 hover:bg-red-500/20 rounded text-zinc-400 hover:text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <svg
                          className="w-4.5 h-4.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
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

      {props.isOwner && activeRegistryId && (
        <div
          className={`transition-all duration-300 ${
            collapsed && !mobileOpen ? "px-1.5 pb-1.5" : "px-4 pb-2"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setShowInvite(true);
            }}
            className={`w-full flex items-center bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-custom text-sm font-semibold text-emerald-400 transition-all duration-300 ${
              collapsed && !mobileOpen
                ? "justify-center p-2.5"
                : "justify-center gap-2 py-2.5 px-3"
            }`}
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            <span
              className={`whitespace-nowrap transition-opacity duration-200 ${
                collapsed && !mobileOpen
                  ? "opacity-0 w-0 overflow-hidden"
                  : "opacity-100"
              }`}
            >
              Invitar
            </span>
          </button>
        </div>
      )}

      {activeRegistryId && (
        <div
          className={`transition-all duration-300 ${
            collapsed && !mobileOpen ? "px-1.5 pb-1.5" : "px-4 pb-2"
          }`}
        >
          <div
            className={`transition-opacity duration-200 ${
              collapsed && !mobileOpen ? "opacity-0 h-0 overflow-hidden" : "opacity-100"
            }`}
          >
            <EntityManager
              registryId={activeRegistryId}
              entities={entityList}
              onEntitiesChanged={handleEntitiesChanged}
            />
          </div>
          {collapsed && !mobileOpen && (
            <button
              type="button"
              onClick={() => {
                if (globalThis.innerWidth < 768) {
                  setMobileOpen(true);
                } else {
                  setCollapsed(false);
                }
              }}
              className="w-full flex items-center justify-center p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-white"
              title="Terceros"
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      <div
        className={`border-t border-white/10 space-y-2 transition-all duration-300 ${
          collapsed && !mobileOpen ? "p-1.5" : "p-4"
        }`}
      >
        <button
          type="button"
          onClick={() => setShowNewRegistry(true)}
          className={`w-full flex items-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-white transition-all duration-300 ${
            collapsed && !mobileOpen
              ? "justify-center p-2.5"
              : "justify-center gap-2 py-3 px-4"
          }`}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M12 4v16m8-8H4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
          <span
            className={`whitespace-nowrap transition-opacity duration-200 ${
              collapsed && !mobileOpen ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
            }`}
          >
            Nuevo Registro
          </span>
        </button>
        {props.showUpgrade && activeRegistryId && (
          <UpgradeButton locale={props.locale ?? "es"} />
        )}
        {(!collapsed || mobileOpen) && (
          <LocaleToggle locale={props.locale ?? "es"} full className="my-1" />
        )}
        <button
          type="button"
          onClick={handleLogout}
          className={`w-full flex items-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-zinc-400 hover:text-red-400 transition-all duration-300 ${
            collapsed && !mobileOpen
              ? "justify-center p-2.5"
              : "justify-center gap-2 py-2.5 px-4"
          }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
          <span
            className={`whitespace-nowrap transition-opacity duration-200 ${
              collapsed && !mobileOpen ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
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
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className={`md:hidden fixed bottom-20 left-4 z-40 w-12 h-12 bg-surface border border-border-custom rounded-full text-white shadow-lg flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all ${
          isStandalone ? "hidden" : ""
        }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </button>

      {(mobileOpen || dragOffset !== null) && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-300"
          style={
            dragOffset !== null
              ? { opacity: (dragOffset / SIDEBAR_WIDTH) * 0.6 }
              : undefined
          }
          onClick={() => {
            setMobileOpen(false);
            setDragOffset(null);
          }}
        />
      )}

      <aside
        className={`hidden md:flex ${
          collapsed ? "w-16" : "w-72"
        } bg-[#0a0a0a] border-r border-white/10 flex-col h-full overflow-hidden transition-[width] duration-300`}
      >
        {sidebarContent}
      </aside>

      <aside
        className={`md:hidden fixed top-0 left-0 z-50 w-72 bg-[#0a0a0a] border-r border-white/10 flex flex-col h-full ${
          dragOffset !== null ? "transition-none" : "transition-transform duration-300"
        }`}
        style={{
          transform: `translateX(${
            dragOffset !== null
              ? `${dragOffset - SIDEBAR_WIDTH}px`
              : mobileOpen
                ? "0"
                : "-100%"
          })`,
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <span className="text-lg font-bold text-white">Menu</span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-2 hover:bg-white/5 rounded-custom text-zinc-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M6 18L18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
        </div>
        {sidebarContent}
      </aside>

      {showInvite && (
        <Modal
          onClose={closeInviteModal}
          title="Invitar al Registro"
          subtitle="Genera un código para invitar a alguien"
          footer={
            <div className="ml-auto">
              <button
                type="button"
                onClick={closeInviteModal}
                className="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cerrar
              </button>
            </div>
          }
        >
          <div className="p-6 space-y-4">
            {!inviteCode ? (
              <button
                type="button"
                onClick={handleCreateInvite}
                disabled={inviteLoading}
                className="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all active:scale-95 disabled:opacity-50"
              >
                {inviteLoading ? "Generando..." : "Generar Código de Invitación"}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="text-center">
                  <p className="text-sm text-zinc-400 mb-2">Código de invitación:</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-3xl font-mono font-bold text-white tracking-widest">
                      {inviteCode}
                    </span>
                    <button
                      type="button"
                      onClick={copyCode}
                      className="p-2 hover:bg-white/10 rounded-custom text-primary transition-colors"
                      title="Copiar"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                    </button>
                  </div>
                  {copied && <p className="text-xs text-emerald-400 mt-1">Copiado!</p>}
                </div>
                <p className="text-xs text-zinc-500 text-center">
                  Comparte este código o el enlace: {globalThis.location.origin}/join/
                  {inviteCode}
                </p>
              </div>
            )}
            {inviteError && <p className="text-sm text-red-300">{inviteError}</p>}
          </div>
        </Modal>
      )}

      {showNewRegistry && (
        <Modal
          onClose={() => setShowNewRegistry(false)}
          title="Nuevo Registro"
          subtitle="Crea un grupo para gestionar gastos compartidos"
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowNewRegistry(false)}
                className="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateRegistry}
                disabled={!newRegistryName.trim() || newRegistryLoading}
                className="px-8 py-2 text-sm font-semibold bg-primary hover:bg-primary-light text-white rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
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
            className="p-6"
          >
            <input
              type="text"
              value={newRegistryName}
              onInput={(e) => setNewRegistryName(e.currentTarget.value)}
              placeholder="Ej: Compañeros de piso"
              className="block w-full px-4 py-2.5 bg-background border border-border-custom rounded-custom text-white focus:ring-primary focus:border-primary"
              autoFocus
            />
          </form>
        </Modal>
      )}

      {showSplitConfig && (
        <DefaultSplitConfig
          registryId={showSplitConfig}
          users={props.registryUsers}
          defaultSplit={
            registries.find((r) => r.id === showSplitConfig)?.defaultSplit ?? null
          }
          isOwner={props.ownerRegistryIds.has(showSplitConfig)}
          autoOpen
          locale={props.locale}
          onClose={() => setShowSplitConfig(null)}
        />
      )}
    </>
  );
}
