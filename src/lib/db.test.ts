import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Connection-selection tests for the real `src/lib/db.ts` — new behavior
 * introduced by the migration: DATABASE_URL is no longer required in dev,
 * and SSL is only enabled for remote hosts (the local docker-compose
 * Postgres doesn't support it).
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

async function importRealDb(): Promise<unknown> {
  vi.resetModules();
  return await vi.importActual("./db");
}

describe("db connection selection (migration behavior)", () => {
  beforeEach(() => {
    poolConfigs.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the local alapar database without SSL when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", undefined as unknown as string);
    await importRealDb();
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
    await importRealDb();
    expect(poolConfigs[0].connectionString).toContain("pooler.supabase.com");
    expect(poolConfigs[0].ssl).toEqual({ rejectUnauthorized: false });
  });

  it("treats 127.0.0.1 as local (no SSL)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://alapar:alapar@127.0.0.1:5432/alapar");
    await importRealDb();
    expect(poolConfigs[0].ssl).toBe(false);
  });

  it("keeps the pool small and fails fast (serverless-friendly settings)", async () => {
    vi.stubEnv("DATABASE_URL", undefined as unknown as string);
    const db = (await importRealDb()) as { getPool(): unknown };
    expect(typeof db.getPool).toBe("function");
    const config = poolConfigs[0] as unknown as Record<string, unknown>;
    expect(config.max).toBe(3);
    expect(config.connectionTimeoutMillis).toBe(5000);
  });
});
