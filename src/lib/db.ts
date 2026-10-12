import pg from "pg";
import type { PoolClient, QueryResult } from "pg";
import { env, isDev } from "./env";

/**
 * Local dev fallback: when DATABASE_URL is unset we assume the docker-compose
 * Postgres (see docker-compose.yml) — db/user/password all `alapar`. SSL is
 * only enabled for remote hosts; the local container doesn't support it.
 */
const LOCAL_FALLBACK = "postgresql://alapar:alapar@localhost:5432/alapar";
const connectionString = env("DATABASE_URL") ?? LOCAL_FALLBACK;
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/|$)/.test(connectionString);

if (isDev && !env("DATABASE_URL")) {
  console.log(`[DB] DATABASE_URL unset — using local fallback ${LOCAL_FALLBACK}`);
}

const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

export function getPool() {
  return pool;
}

/** A `query`-compatible executor — the pool itself or a transaction's client. */
export type QueryFn = (
  text: string,
  params?: unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

type Executor = (text: string, params?: unknown[]) => Promise<QueryResult>;

async function runLogged(
  executor: Executor,
  text: string,
  params?: unknown[],
): Promise<QueryResult<Record<string, unknown>>> {
  const start = Date.now();
  if (isDev) {
    console.log(`[DB] >> ${text.replace(/\n/g, " ").substring(0, 120)}`);
  }
  try {
    const result = await executor(text, params);
    if (isDev) {
      console.log(`[DB] << OK (${Date.now() - start}ms, ${result.rows.length} rows)`);
    }
    return result as QueryResult<Record<string, unknown>>;
  } catch (err) {
    if (isDev) {
      console.log(`[DB] << ERROR (${Date.now() - start}ms):`, err);
    }
    throw err;
  }
}

/**
 * Run `fn` inside a single SQL transaction on a dedicated pool client.
 *
 * Multi-statement invariants (transaction + payments + balance deltas,
 * invitation claim + member insert) must not be observable half-applied: a
 * failure anywhere inside `fn` rolls the whole sequence back. All statements
 * in the unit go through the `q` passed to `fn` — using the module-level
 * `query` inside would escape the transaction.
 */
export async function withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  const q: QueryFn = (text, params) => runLogged(client.query.bind(client), text, params);
  try {
    await client.query("BEGIN");
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; releasing it below drops it.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run a parameterized query. The explicit return type is load-bearing: pg's
 * `pool.query` overloads infer the row generic inconsistently across
 * versions (sometimes `any[]`, sometimes `{}[]`), and an unannotated return
 * let that inconsistency cascade through every caller. Pinning
 * `QueryResult<Record<string, unknown>>` gives every call site a stable
 * row shape; row mappers cast individual fields as needed.
 */
export function query(
  text: string,
  params?: unknown[],
): Promise<QueryResult<Record<string, unknown>>> {
  return runLogged(pool.query.bind(pool), text, params);
}
