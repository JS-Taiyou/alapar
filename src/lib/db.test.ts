import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Connection-selection tests for the real `src/lib/db.ts` — behavior
 * introduced by the migrations: DATABASE_URL is no longer required in dev,
 * SSL is only enabled for remote hosts (the local docker-compose Postgres
 * doesn't support it), and the pool is built lazily so a Workers Hyperdrive
 * binding (registered per-isolate via setRuntimeConnectionString) can take
 * precedence over DATABASE_URL.
 *
 * The global setup mocks `@/lib/db` with the query stub, so this file goes
 * through `vi.importActual` to load the real module — with `pg` itself
 * mocked, so no real pool or connection is ever created.
 */

interface PoolConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
}

const poolConfigs: PoolConfig[] = [];

vi.mock("pg", () => {
  class Pool {
    constructor(config: PoolConfig) {
      poolConfigs.push(config);
    }
  }
  return { default: { Pool }, Pool };
});

interface RealDb {
  getPool(): unknown;
  setRuntimeConnectionString(cs: string): void;
}

async function importRealDb(): Promise<RealDb> {
  vi.resetModules();
  return (await vi.importActual("./db")) as RealDb;
}

/** The pool is lazy now: exercising getPool() is what builds it. */
async function importRealDbAndConnect(): Promise<RealDb> {
  const db = await importRealDb();
  db.getPool();
  return db;
}

describe("db connection selection (migration behavior)", () => {
  beforeEach(() => {
    poolConfigs.length = 0;
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
  });

  it("falls back to the local alapar database without SSL when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", undefined as unknown as string);
    await importRealDbAndConnect();
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
    await importRealDbAndConnect();
    expect(poolConfigs[0].connectionString).toContain("pooler.supabase.com");
    expect(poolConfigs[0].ssl).toEqual({ rejectUnauthorized: false });
  });

  it("treats 127.0.0.1 as local (no SSL)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://alapar:alapar@127.0.0.1:5432/alapar");
    await importRealDbAndConnect();
    expect(poolConfigs[0].ssl).toBe(false);
  });

  it("prefers the runtime-registered (Hyperdrive) string over DATABASE_URL", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres.proj:secret@aws-1-region.pooler.supabase.com:6543/postgres",
    );
    const db = await importRealDb();
    db.setRuntimeConnectionString(
      "postgresql://hyperdrive-user:pass@hyperdrive-host.internal:5432/postgres",
    );
    db.getPool();
    expect(poolConfigs[0].connectionString).toContain("hyperdrive-host.internal");
    expect(poolConfigs[0].ssl).toEqual({ rejectUnauthorized: false });
  });

  it("keeps the pool small and fails fast (serverless-friendly settings)", async () => {
    vi.stubEnv("DATABASE_URL", undefined as unknown as string);
    await importRealDbAndConnect();
    const config = poolConfigs[0] as unknown as Record<string, unknown>;
    expect(config.max).toBe(3);
    expect(config.connectionTimeoutMillis).toBe(5000);
  });
});
