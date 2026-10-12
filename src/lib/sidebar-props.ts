import type { AstroGlobal } from "astro";
import type { DefaultSplit, Entity, Registry, User } from "./types";
import type { Locale } from "./i18n";
import { getTransactionCounts } from "./store";
import { getCachedTransactionCounts, setCachedTransactionCounts } from "./server-cache";
import { initials } from "./format";

/**
 * Server-side props every Sidebar mount needs. The middleware has already
 * populated Astro.locals; the only real work is the deletable-registry set
 * (registries with zero transactions), which goes through the cached
 * transaction counts.
 */
export interface SidebarServerProps {
  registries: Registry[];
  activeRegistryId: string;
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
}

export async function getSidebarServerProps(Astro: AstroGlobal): Promise<SidebarServerProps> {
  const user = Astro.locals.user;
  const userName = user?.name ?? "Usuario";

  const deletableRegistryIds = new Set<string>();
  if (Astro.locals.registries.length > 0) {
    const registryIds = Astro.locals.registries.map((r) => r.id);
    const { counts, hit } = getCachedTransactionCounts(registryIds);
    let finalCounts = counts;
    if (!hit) {
      finalCounts = await getTransactionCounts(registryIds);
      void setCachedTransactionCounts(finalCounts);
    }
    for (const r of Astro.locals.registries) {
      if ((finalCounts.get(r.id) ?? 0) === 0) deletableRegistryIds.add(r.id);
    }
  }

  const sidebarCollapsed = Astro.request.headers
    .get("cookie")
    ?.split(";")
    .some((c) => c.trim() === "sidebar-collapsed=true") ?? false;

  return {
    registries: Astro.locals.registries,
    activeRegistryId: Astro.locals.activeRegistry?.id ?? "",
    userName,
    userInitials: initials(userName),
    userPro: user?.pro ?? null,
    isOwner: Astro.locals.isOwner,
    ownerRegistryIds: Astro.locals.ownerRegistryIds,
    entities: Astro.locals.entities,
    registryUsers: Astro.locals.registryUsers,
    defaultSplit: Astro.locals.activeRegistry?.defaultSplit ?? null,
    deletableRegistryIds,
    initialCollapsed: sidebarCollapsed,
    locale: Astro.locals.locale,
    showUpgrade: Astro.locals.activeRegistryPlan !== null &&
      !Astro.locals.activeRegistryPlan.isPro,
  };
}
