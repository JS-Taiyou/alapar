import { query } from "./db";
import type { Transaction } from "./types";

/**
 * Per-registry cache entry. Each dataset (transactions, spawn candidates,
 * transaction counts) is populated independently — a dataset that was never
 * fetched is `undefined` and therefore never a hit. All datasets share the
 * registry's `lastModified` stamp, so any mutation invalidates them together
 * via `invalidateRegistry`.
 */
interface RegistryCache {
  transactions?: Transaction[];
  spawnCandidates?: Transaction[];
  transactionCounts?: Map<string, number>;
  lastModified: string | null;
  cachedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map<string, RegistryCache>();
const userActiveRegistries = new Map<string, string>();

function evictIfNeeded(): void {
  if (cache.size < MAX_ENTRIES) return;
  const now = Date.now();
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      cache.delete(key);
      if (cache.size < MAX_ENTRIES) return;
    }
    if (entry.cachedAt < oldestTime) {
      oldestTime = entry.cachedAt;
      oldestKey = key;
    }
  }
  if (oldestKey && cache.size >= MAX_ENTRIES) {
    cache.delete(oldestKey);
  }
}

/**
 * Evict the registry's in-memory entry after a mutation.
 *
 * The `last_modified` bump itself now happens INSIDE the mutation's SQL
 * transaction (see `touchRegistryStamp` in store.ts) — data and stamp commit
 * atomically, and entries cached by other isolates miss on the stamp
 * comparison. This eviction only saves this isolate from serving a stale
 * entry during the stamp-read race window right after commit.
 */
export function invalidateRegistry(registryId: string): void {
  cache.delete(registryId);
}

export function clearAll(): void {
  cache.clear();
}

export async function getStamp(registryId: string): Promise<string | null> {
  const result = await query(
    "SELECT last_modified FROM registries WHERE id = $1",
    [registryId],
  );
  if (result.rows.length === 0) return null;
  const lm = result.rows[0].last_modified;
  return lm ? new Date(lm as string).toISOString() : null;
}

/**
 * Get (or fill) the registry's active-transaction snapshot. Presence-based
 * hit check: an entry written by {@link getCachedSpawnCandidates} has no
 * `transactions` yet and must not answer here with an empty list.
 */
export async function getCachedTransactions(
  registryId: string,
  fetcher: () => Promise<Transaction[]>,
  prefetchedStamp?: string | null,
): Promise<{ transactions: Transaction[]; hit: boolean }> {
  const stamp = prefetchedStamp !== undefined
    ? prefetchedStamp
    : await getStamp(registryId);
  const entry = cache.get(registryId);

  // `stamp !== null`: a NULL last_modified means "version unknown" and must
  // never be a hit — comparing null === null would pin pre-mutation data in
  // the cache (and in the client's snapshot) forever.
  if (
    entry && entry.transactions !== undefined && stamp !== null &&
    entry.lastModified === stamp && Date.now() - entry.cachedAt < CACHE_TTL_MS
  ) {
    return { transactions: entry.transactions, hit: true };
  }

  const transactions = await fetcher();
  writeDataset(registryId, stamp, (e) => {
    e.transactions = transactions;
  });
  return { transactions, hit: false };
}

/**
 * Get (or fill) the registry's recurring-spawn candidates. Empty candidate
 * lists are cached like any other value — registries with no recurring
 * templates are the common case and must not re-query on every request.
 */
export async function getCachedSpawnCandidates(
  registryId: string,
  fetcher: () => Promise<Transaction[]>,
  prefetchedStamp?: string | null,
): Promise<Transaction[]> {
  const stamp = prefetchedStamp !== undefined
    ? prefetchedStamp
    : await getStamp(registryId);
  const entry = cache.get(registryId);

  // Same null guard as getCachedTransactions: unknown version, no hits.
  if (
    entry && entry.spawnCandidates !== undefined && stamp !== null &&
    entry.lastModified === stamp && Date.now() - entry.cachedAt < CACHE_TTL_MS
  ) {
    return entry.spawnCandidates;
  }

  const candidates = await fetcher();
  writeDataset(registryId, stamp, (e) => {
    e.spawnCandidates = candidates;
  });
  return candidates;
}

/**
 * Mutate one dataset of the entry, keeping the other datasets and the stamp
 * coherent: the data was just fetched against the CURRENT stamp, so
 * `cachedAt` resets (the TTL clock starts when the data was verified, not
 * when the entry was created).
 */
function writeDataset(
  registryId: string,
  stamp: string | null,
  mutate: (entry: RegistryCache) => void,
): void {
  const entry = cache.get(registryId);
  if (entry && entry.lastModified === stamp) {
    mutate(entry);
    entry.cachedAt = Date.now();
    return;
  }
  evictIfNeeded();
  const fresh: RegistryCache = {
    lastModified: stamp,
    cachedAt: Date.now(),
  };
  mutate(fresh);
  cache.set(registryId, fresh);
}

export function getCachedTransactionCounts(
  registryIds: string[],
): { counts: Map<string, number>; hit: boolean } {
  const now = Date.now();
  for (const id of registryIds) {
    const entry = cache.get(id);
    if (
      !entry || entry.transactionCounts === undefined ||
      now - entry.cachedAt >= CACHE_TTL_MS
    ) {
      return { counts: new Map(), hit: false };
    }
  }

  const counts = new Map<string, number>();
  for (const id of registryIds) {
    const entry = cache.get(id);
    if (entry?.transactionCounts) {
      for (const [rid, cnt] of entry.transactionCounts) {
        counts.set(rid, cnt);
      }
    }
  }
  return { counts, hit: true };
}

export function setCachedTransactionCounts(
  counts: Map<string, number>,
): void {
  for (const [registryId] of counts) {
    const entry = cache.get(registryId);
    if (entry) {
      entry.transactionCounts = counts;
    }
  }
}

export function getUserActiveRegistry(userId: string): string | null {
  return userActiveRegistries.get(userId) ?? null;
}

export function setUserActiveRegistry(
  userId: string,
  registryId: string,
): void {
  userActiveRegistries.set(userId, registryId);
}
