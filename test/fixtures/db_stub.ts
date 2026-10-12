/**
 * Test-only stub for `src/lib/db.ts`.
 *
 * The real `src/lib/db.ts` creates a live `pg.Pool` at import time. Tests
 * don't want that. This stub is wired in via a `vi.mock("@/lib/db", ...)` in
 * `test/setup.ts`, so every module imported during a test run gets a
 * controllable `query()` instead of a real database connection — the same
 * role the Deno import-map remap played (`"./lib/db.ts" → this file`).
 *
 * Controlling the stub:
 *   - {@link __setQueryResult} — install the rows / rowCount the next `query()`
 *     calls should return. Pass a fixed result, or a function of
 *     `(text, params)` for per-query responses.
 *   - {@link __queryLog} — array recording every `(text, params)` call, for
 *     assertions about which queries ran and with what arguments.
 *   - {@link __resetDbStub} — clear log + result between tests.
 *
 * The default behavior (no result installed) returns empty rows, so tests that
 * never reach `query()` are unaffected.
 */

export interface QueryCall {
  text: string;
  params: unknown[];
}

export const __queryLog: QueryCall[] = [];

type ResultSpec =
  | { rows: Record<string, unknown>[]; rowCount?: number }
  | ((text: string, params: unknown[]) => { rows: Record<string, unknown>[]; rowCount?: number });

let resultFn: ResultSpec = { rows: [] };

/**
 * Install what the stubbed `query()` should return.
 * Pass either a fixed result object, or a function of `(text, params)` for
 * per-call responses.
 */
export function __setQueryResult(spec: ResultSpec): void {
  resultFn = spec;
}

/** Clear the query log and reset the result to empty rows. */
export function __resetDbStub(): void {
  __queryLog.length = 0;
  resultFn = { rows: [] };
}

export function getPool() {
  // Tests never use the pool. Returning an empty object keeps the import
  // surface compatible with the real module without pulling in `pg`.
  return {} as unknown;
}

/** Mirrors the real module's QueryFn type through the stub's `query` shape. */
export type QueryFn = typeof query;

export function query(
  text: string,
  params?: unknown[],
): Promise<{
  // rows is `any[]` to match the real `pg` QueryResult, where callers assign
  // result.rows directly to typed arrays (e.g. `const subs: PushSubscription[] = result.rows`).
  // deno-lint-ignore no-explicit-any
  rows: any[];
  rowCount: number;
}> {
  __queryLog.push({ text, params: params ?? [] });
  const resolved = typeof resultFn === "function" ? resultFn(text, params ?? []) : resultFn;
  return Promise.resolve({
    rows: resolved.rows,
    rowCount: resolved.rowCount ?? resolved.rows.length,
  });
}

/**
 * Stub for the real `withTransaction`: no BEGIN/COMMIT (the stub has no
 * client to connect), just run the unit against the stubbed `query` so tests
 * exercise the same code path with the same result-injection semantics.
 */
export async function withTransaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  return await fn(query);
}
