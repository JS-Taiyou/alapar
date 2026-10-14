import pg from "pg";
import type { PoolClient, QueryResult } from "pg";
import { env, isDev } from "./env";

/**
 * Local dev fallback: when DATABASE_URL is unset we assume the local
 * Postgres — db/user/password all `alapar` (see the README dev section;
 * docker-compose.yml also works). SSL is only enabled for remote hosts.
 */
const LOCAL_FALLBACK = "postgresql://alapar:alapar@localhost:5432/alapar";

/**
 * Two connection strategies, matching the official guidance:
 *
 * - Hyperdrive (Workers): a NEW `Client` per call — never a Pool. Cloudflare's
 *   canonical pattern ("New client per request; Hyperdrive maintains the
 *   underlying connection pool, so creating a new client is fast") keeps NO
 *   socket state across requests on our side; the real Postgres pooling lives
 *   inside Hyperdrive. Pool-held shim sockets crossing request boundaries
 *   were the root cause of a full day of intermittent 500s (sockets die
 *   silently; the next request touching them hangs or terminates).
 *   Connection string comes from the middleware registering the HYPERDRIVE
 *   binding once per isolate. Origin should be Supabase's DIRECT connection
 *   string (Hyperdrive does its own pooling).
 *
 * - Plain Node (dev, tests, a persistent server): a long-lived Pool is the
 *   correct pattern here — real OS sockets don't die in silence.
 *
 * Nothing may read the connection string at module scope: on Workers the
 * Hyperdrive binding only exists per-request.
 */
let runtimeConnectionString: string | null = null;
let pool: pg.Pool | null = null;

export function setRuntimeConnectionString(connectionString: string): void {
  if (pool) return; // already built — the registration came too late
  runtimeConnectionString = connectionString;
}

function resolveConnectionString(): string {
  const fromEnv = env("DATABASE_URL");
  if (isDev && !runtimeConnectionString && !fromEnv) {
    console.log(`[DB] DATABASE_URL unset — using local fallback ${LOCAL_FALLBACK}`);
  }
  return runtimeConnectionString ?? fromEnv ?? LOCAL_FALLBACK;
}

function isLocalHost(connectionString: string): boolean {
  return /@(localhost|127\.0\.0\.1)(:|\/|$)/.test(connectionString);
}

/** A `query`-compatible executor — a pool, a client, or a transaction. */
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

function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: resolveConnectionString(),
    ssl: isLocalHost(resolveConnectionString()) ? false : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  return pool;
}

/**
 * Run `fn` with a one-shot Client against the registered Hyperdrive
 * endpoint — connect, use, end. Canonical Workers pattern: no socket
 * survives the call.
 */
async function withHyperdriveClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: runtimeConnectionString! });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.end();
  }
}

/**
 * Run `fn` inside a single SQL transaction on a dedicated connection.
 *
 * Multi-statement invariants (transaction + payments + balance deltas,
 * invitation claim + member insert) must not be observable half-applied: a
 * failure anywhere inside `fn` rolls the whole sequence back. All statements
 * in the unit go through the `q` passed to `fn` — using the module-level
 * `query` inside would escape the transaction.
 */
export async function withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  if (runtimeConnectionString) {
    return withHyperdriveClient(async (client) => {
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
          // The connection is already broken; ending it below drops it.
        }
        throw err;
      }
    });
  }

  const client: PoolClient = await getPool().connect();
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
 * `query` overloads infer the row generic inconsistently across versions
 * (sometimes `any[]`, sometimes `{}[]`), and an unannotated return let that
 * inconsistency cascade through every caller. Pinning
 * `QueryResult<Record<string, unknown>>` gives every call site a stable row
 * shape; row mappers cast individual fields as needed.
 */
export function query(
  text: string,
  params?: unknown[],
): Promise<QueryResult<Record<string, unknown>>> {
  if (runtimeConnectionString) {
    return withHyperdriveClient((client) => runLogged(client.query.bind(client), text, params));
  }
  const activePool = getPool();
  return runLogged(activePool.query.bind(activePool), text, params);
}
