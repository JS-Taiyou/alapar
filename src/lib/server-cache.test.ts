/**
 * Tests for the in-memory server cache.
 *
 * `lib/server-cache.ts` imports `query` from `./db.ts`. Under the test config
 * (`deno.test.json`) that import is redirected to `test/fixtures/db_stub.ts`,
 * so these tests control what the cache's stamp/invalidation queries return via
 * `__setQueryResult` and assert on the queries via `__queryLog`.
 */
import { assertEquals } from "@test/compat";
import type { Transaction } from "./types";
import { beforeEach, describe, it } from "@test/compat";
import {
  clearAll,
  getCachedSpawnCandidates,
  getCachedTransactionCounts,
  getCachedTransactions,
  getUserActiveRegistry,
  invalidateRegistry,
  setCachedTransactionCounts,
  setUserActiveRegistry,
} from "./server-cache";
import { __queryLog, __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const STAMP = "2024-01-01T00:00:00.000Z";

beforeEach(() => {
  clearAll();
  __resetDbStub();
});

describe("getUserActiveRegistry / setUserActiveRegistry", () => {
  it("returns null when no active registry is set", () => {
    assertEquals(getUserActiveRegistry("u1"), null);
  });

  it("returns the registry id after it is set", () => {
    setUserActiveRegistry("u1", "reg-1");
    assertEquals(getUserActiveRegistry("u1"), "reg-1");
  });

  it("overwrites the previous value on re-set", () => {
    setUserActiveRegistry("u1", "reg-1");
    setUserActiveRegistry("u1", "reg-2");
    assertEquals(getUserActiveRegistry("u1"), "reg-2");
  });

  it("keeps separate users independent", () => {
    setUserActiveRegistry("u1", "reg-a");
    setUserActiveRegistry("u2", "reg-b");
    assertEquals(getUserActiveRegistry("u1"), "reg-a");
    assertEquals(getUserActiveRegistry("u2"), "reg-b");
  });
});

describe("invalidateRegistry", () => {
  it("issues no queries — the stamp bump lives in the mutation's transaction", async () => {
    invalidateRegistry("reg-1");
    await Promise.resolve();
    assertEquals(__queryLog.length, 0);
  });

  it("evicts a cached dataset so the next read is a miss", async () => {
    __setQueryResult({ rows: [{ last_modified: STAMP }] });
    const fetcher = () => Promise.resolve([{ id: "tx-1" } as Transaction]);
    await getCachedTransactions("reg-1", fetcher);

    invalidateRegistry("reg-1");

    const second = await getCachedTransactions("reg-1", fetcher);
    assertEquals(second.hit, false);
  });
});

describe("getCachedTransactions", () => {
  it("reports a miss (hit:false) on first call and caches the fetcher result", async () => {
    __setQueryResult({ rows: [{ last_modified: STAMP }] });
    let fetcherCalls = 0;
    const fetcher = (): Promise<Transaction[]> => {
      fetcherCalls++;
      return Promise.resolve([{ id: "tx-1" } as Transaction]);
    };

    const first = await getCachedTransactions("reg-1", fetcher);
    assertEquals(first.hit, false);
    assertEquals(first.transactions.length, 1);
    assertEquals(fetcherCalls, 1);
  });

  it("reports a hit on the second call when the stamp is unchanged", async () => {
    __setQueryResult({ rows: [{ last_modified: STAMP }] });
    let fetcherCalls = 0;
    const fetcher = (): Promise<Transaction[]> => {
      fetcherCalls++;
      return Promise.resolve([{ id: "tx-1" } as Transaction]);
    };

    await getCachedTransactions("reg-1", fetcher);
    const second = await getCachedTransactions("reg-1", fetcher);
    assertEquals(second.hit, true);
    assertEquals(second.transactions.length, 1);
    assertEquals(fetcherCalls, 1); // fetcher not called on hit
  });

  it("reports a miss when the stamp changes between calls", async () => {
    __setQueryResult((_text, _params) => ({
      rows: [{ last_modified: "2024-02-01T00:00:00.000Z" }],
    }));
    let calls = 0;
    const fetcher = (): Promise<Transaction[]> => {
      calls++;
      return Promise.resolve([{ id: `tx-${calls}` } as Transaction]);
    };

    await getCachedTransactions("reg-1", fetcher);
    // Change the stamp for the second call.
    __setQueryResult((_t, _p) => ({
      rows: [{ last_modified: "2024-03-01T00:00:00.000Z" }],
    }));
    const second = await getCachedTransactions("reg-1", fetcher);
    assertEquals(second.hit, false);
    assertEquals(calls, 2);
  });

  it("returns null stamp and refetches when the registry row is absent", async () => {
    __setQueryResult({ rows: [] });
    const fetcher = (): Promise<Transaction[]> => Promise.resolve([{ id: "tx-1" } as Transaction]);
    const result = await getCachedTransactions("reg-1", fetcher);
    assertEquals(result.hit, false);
    assertEquals(result.transactions.length, 1);
  });

  it("never hits on a NULL last_modified (version unknown, null === null must not match)", async () => {
    __setQueryResult({ rows: [{ last_modified: null }] });
    let fetcherCalls = 0;
    const fetcher = (): Promise<Transaction[]> => {
      fetcherCalls++;
      return Promise.resolve([{ id: "tx-1" } as Transaction]);
    };

    await getCachedTransactions("reg-1", fetcher);
    const second = await getCachedTransactions("reg-1", fetcher);

    assertEquals(second.hit, false);
    assertEquals(fetcherCalls, 2);
  });
});

describe("cross-dataset isolation", () => {
  // The two getters share one entry per registry; these tests pin the
  // contract that a dataset nobody fetched is never served as a hit.
  it("does not serve empty transactions after spawn candidates ran first", async () => {
    __setQueryResult({ rows: [{ last_modified: STAMP }] });
    let txFetcherCalls = 0;

    await getCachedSpawnCandidates("reg-1", () => Promise.resolve([{ id: "c-1" } as Transaction]));

    const result = await getCachedTransactions("reg-1", () => {
      txFetcherCalls++;
      return Promise.resolve([{ id: "tx-1" } as Transaction]);
    });

    assertEquals(result.hit, false);
    assertEquals(result.transactions.length, 1);
    assertEquals(txFetcherCalls, 1);
  });

  it("does not refetch spawn candidates when the cached list is empty", async () => {
    __setQueryResult({ rows: [{ last_modified: STAMP }] });
    let spawnFetcherCalls = 0;
    const fetcher = (): Promise<Transaction[]> => {
      spawnFetcherCalls++;
      return Promise.resolve([]);
    };

    await getCachedSpawnCandidates("reg-1", fetcher);
    const second = await getCachedSpawnCandidates("reg-1", fetcher);

    assertEquals(second.length, 0);
    assertEquals(spawnFetcherCalls, 1); // empty list IS a hit
  });

  it("never hits spawn candidates on a NULL last_modified either", async () => {
    __setQueryResult({ rows: [{ last_modified: null }] });
    let spawnFetcherCalls = 0;
    const fetcher = (): Promise<Transaction[]> => {
      spawnFetcherCalls++;
      return Promise.resolve([]);
    };

    await getCachedSpawnCandidates("reg-1", fetcher);
    await getCachedSpawnCandidates("reg-1", fetcher);

    assertEquals(spawnFetcherCalls, 2);
  });

  it("keeps both datasets in one entry without clobbering each other", async () => {
    __setQueryResult({ rows: [{ last_modified: STAMP }] });

    const txs = await getCachedTransactions("reg-1", () =>
      Promise.resolve([{ id: "tx-1" } as Transaction]),
    );
    const spawns = await getCachedSpawnCandidates("reg-1", () =>
      Promise.resolve([{ id: "c-1" } as Transaction]),
    );
    const txsAgain = await getCachedTransactions("reg-1", () =>
      Promise.resolve([{ id: "SHOULD-NOT-RUN" } as Transaction]),
    );

    assertEquals(txs.hit, false);
    assertEquals(spawns.length, 1);
    assertEquals(txsAgain.hit, true); // transactions survived the spawn write
    assertEquals(txsAgain.transactions[0].id, "tx-1");
  });
});

describe("getCachedTransactionCounts", () => {
  it("returns hit:false when no registries are cached", () => {
    const { counts, hit } = getCachedTransactionCounts(["reg-1"]);
    assertEquals(hit, false);
    assertEquals(counts.size, 0);
  });

  it("returns hit:true with empty counts for an empty input array", () => {
    // Quirk: with no registry ids to check, the loop doesn't run and we fall
    // through to the hit:true branch with an empty map.
    const { counts, hit } = getCachedTransactionCounts([]);
    assertEquals(hit, true);
    assertEquals(counts.size, 0);
  });
});

describe("setCachedTransactionCounts", () => {
  it("silently skips registries that have no cache entry", () => {
    // No cache entry for reg-1 → setCachedTransactionCounts is a no-op,
    // and subsequent getCachedTransactionCounts still reports a miss.
    setCachedTransactionCounts(new Map([["reg-1", 5]]));
    const { hit } = getCachedTransactionCounts(["reg-1"]);
    assertEquals(hit, false);
  });
});
