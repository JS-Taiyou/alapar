import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Connection-selection tests for the real `src/lib/db.ts`, covering both
 * strategies: the canonical Workers pattern (a one-shot `Client` per call
 * against the registered Hyperdrive string — never a Pool, matching
 * Cloudflare's official guidance) and the plain-Node Pool (dev/tests).
 *
 * The global setup mocks `@/lib/db` with the query stub, so this file goes
 * through `vi.importActual` to load the real module — with `pg` itself
 * mocked, so no real connection is ever made.
 */

interface PoolConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
}

interface ClientConfig {
  connectionString: string;
  ssl?: unknown;
}

const poolConfigs: PoolConfig[] = [];
const clientConfigs: ClientConfig[] = [];
const clientEvents: string[] = [];

function fakeResult(): unknown {
  return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
}

vi.mock("pg", () => {
  class Pool {
    constructor(config: PoolConfig) {
      poolConfigs.push(config);
    }
    query() {
      return Promise.resolve(fakeResult());
    }
  }
  class Client {
    constructor(config: ClientConfig) {
      clientConfigs.push(config);
    }
    connect() {
      clientEvents.push("connect");
      return Promise.resolve();
    }
    query() {
      clientEvents.push("query");
      return Promise.resolve(fakeResult());
    }
    end() {
      clientEvents.push("end");
      return Promise.resolve();
    }
  }
  return { default: { Pool, Client }, Pool, Client };
});

interface RealDb {
  query(text: string, params?: unknown[]): Promise<unknown>;
  withTransaction(fn: (q: (t: string) => Promise<unknown>) => Promise<void>): Promise<unknown>;
  setRuntimeConnectionString(cs: string): void;
}

async function importRealDb(): Promise<RealDb> {
  vi.resetModules();
  return (await vi.importActual("./db")) as RealDb;
}

describe("db connection selection (migration behavior)", () => {
  beforeEach(() => {
    poolConfigs.length = 0;
    clientConfigs.length = 0;
    clientEvents.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds no pool at import time (Hyperdrive registers per-request)", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres.proj:s@aws-1-r.pooler.supabase.com:6543/postgres",
    );
    await importRealDb();
    expect(poolConfigs).toHaveLength(0);
    expect(clientConfigs).toHaveLength(0);
  });

  it("falls back to the local alapar database without SSL when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", undefined as unknown as string);
    const db = await importRealDb();
    await db.query("select 1");
    expect(poolConfigs).toHaveLength(1);
    expect(poolConfigs[0].connectionString).toBe(
      "postgresql://alapar:alapar@localhost:5432/alapar",
    );
    expect(poolConfigs[0].ssl).toBe(false);
  });

  it("uses DATABASE_URL with relaxed SSL for remote hosts (Supabase pooler)", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres.proj:secret@aws-1-region.pooler.supabase.com:6543/postgres",
    );
    const db = await importRealDb();
    await db.query("select 1");
    expect(poolConfigs[0].connectionString).toContain("pooler.supabase.com");
    expect(poolConfigs[0].ssl).toEqual({ rejectUnauthorized: false });
  });

  it("treats 127.0.0.1 as local (no SSL)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://alapar:alapar@127.0.0.1:5432/alapar");
    const db = await importRealDb();
    await db.query("select 1");
    expect(poolConfigs[0].ssl).toBe(false);
  });

  it("keeps the plain-Node pool small and fast-fail (serverless-friendly settings)", async () => {
    vi.stubEnv("DATABASE_URL", undefined as unknown as string);
    const db = await importRealDb();
    await db.query("select 1");
    const config = poolConfigs[0] as unknown as Record<string, unknown>;
    expect(config.max).toBe(3);
    expect(config.connectionTimeoutMillis).toBe(5000);
  });

  it("prefers the runtime-registered (Hyperdrive) string and NEVER builds a pool", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres.proj:secret@aws-1-region.pooler.supabase.com:6543/postgres",
    );
    const db = await importRealDb();
    db.setRuntimeConnectionString(
      "postgresql://hyperdrive-user:pass@hyperdrive-host.internal:5432/postgres",
    );
    await db.query("select 1");
    expect(poolConfigs).toHaveLength(0);
    expect(clientConfigs).toHaveLength(1);
    expect(clientConfigs[0].connectionString).toContain("hyperdrive-host.internal");
  });

  it("uses the canonical bare Client config on the Hyperdrive path (connectionString only)", async () => {
    const db = await importRealDb();
    db.setRuntimeConnectionString(
      "postgresql://hyperdrive-user:pass@hyperdrive-host.internal:5432/postgres",
    );
    await db.query("select 1");
    expect(Object.keys(clientConfigs[0])).toEqual(["connectionString"]);
    // Connect → query → end, per call: no socket state survives.
    expect(clientEvents).toEqual(["connect", "query", "end"]);
  });

  it("runs withTransaction on a single Hyperdrive client (BEGIN…COMMIT, one end)", async () => {
    const db = await importRealDb();
    db.setRuntimeConnectionString(
      "postgresql://hyperdrive-user:pass@hyperdrive-host.internal:5432/postgres",
    );
    await db.withTransaction(async (q) => {
      await q("select 1");
      await q("select 2");
    });
    expect(clientConfigs).toHaveLength(1);
    expect(clientEvents).toEqual([
      "connect",
      "query", // BEGIN
      "query", // select 1
      "query", // select 2
      "query", // COMMIT
      "end",
    ]);
  });
});
