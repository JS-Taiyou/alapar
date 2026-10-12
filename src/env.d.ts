/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import("@/lib/types").User | null;
    activeRegistry: import("@/lib/types").Registry | null;
    registryUsers: import("@/lib/types").User[];
    entities: import("@/lib/types").Entity[];
    participants: import("@/lib/types").Participant[];
    registries: import("@/lib/types").Registry[];
    supabaseAuthId: string | null;
    accessToken: string | null;
    isOwner: boolean;
    ownerRegistryIds: Set<string>;
    locale: import("@/lib/i18n").Locale;
    /** Plan of the ACTIVE registry (null on lightweight paths / no registry).
     * Populated by the middleware on full-state paths so pages/islands can
     * render upgrade CTAs without extra queries. */
    activeRegistryPlan: import("@/lib/entitlements").RegistryPlanInfo | null;
  }
}
