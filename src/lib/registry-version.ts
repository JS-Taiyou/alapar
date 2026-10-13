import type { KVNamespace } from "@cloudflare/workers-types";
import { getRegistryStamp } from "./store";

/**
 * Registry version mirror in Workers KV — the cheap outer gate of the
 * polling sync (retired Supabase Realtime).
 *
 * Mutating endpoints call {@link bumpRegistryVersion} AFTER their transaction
 * commits: it reads the registry's authoritative `last_modified` from
 * Postgres and mirrors it to KV. Clients poll GET /api/version/<rid> (a KV
 * read — no Postgres, no Supabase, ~ms) and only run the full stamp-gated
 * sync when the mirrored version differs from the `lastModified` they
 * already hold. Because both sides are Postgres-sourced, a client's own
 * mutation (which hands it the new stamp via onServerStamp) matches the
 * mirror immediately — no self-triggered refetch.
 *
 * The KV namespace is registered per-isolate by the middleware (same
 * pattern as the Hyperdrive connection string); without registration this
 * module is a no-op — plain-Node runtimes (tests, astro dev without the
 * binding) never touch KV, and the version endpoint falls back to reading
 * the Postgres stamp directly.
 *
 * Consistency note: Workers KV is eventually consistent (up to ~60s
 * cross-colo). With hourly polling that window is noise; a missed bump
 * surfaces on the next poll.
 */

const VERSION_PREFIX = "alapar-ver:";

let kvNamespace: KVNamespace | null = null;

export function setVersionNamespace(namespace: unknown): void {
  kvNamespace = (namespace ?? null) as KVNamespace | null;
}

export function versionNamespaceRegistered(): boolean {
  return kvNamespace !== null;
}

/** Mirror the registry's current Postgres stamp into KV. Fire-and-forget. */
export async function bumpRegistryVersion(registryId: string): Promise<void> {
  if (!kvNamespace) return;
  try {
    const stamp = await getRegistryStamp(registryId);
    if (stamp !== null) {
      await kvNamespace.put(VERSION_PREFIX + registryId, stamp);
    }
  } catch {
    // The mutation itself already committed — a failed mirror only delays
    // the next poll's detection; never fail the request over it.
  }
}

/** Read the mirrored version, or null when never written / unavailable. */
export async function getRegistryVersion(registryId: string): Promise<string | null> {
  if (!kvNamespace) return null;
  try {
    return await kvNamespace.get(VERSION_PREFIX + registryId);
  } catch {
    return null;
  }
}
