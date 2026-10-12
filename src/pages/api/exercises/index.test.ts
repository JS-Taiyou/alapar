/**
 * Tests for the exercises collection route handler.
 *
 * The POST handler is the most branchy in the app: it sniffs content-type,
 * branches on the Accept header (JSON error vs redirect), requires OWNERSHIP
 * of the target registry (S8 — closing an exercise is destructive),
 * short-circuits when there are no active transactions, and decides whether
 * to emit balance "ajuste" transactions based on a rounding threshold
 * (`totalPending > 0.01 * active.length`).
 *
 * These tests focus on the pre-DB validation/branching, the empty-active
 * short-circuit, and the full archive + ajuste flow (which runs inside one
 * withTransaction unit — the stub flattens it, but the orchestration and
 * ajuste decision are exercised for real).
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./index";
import { jsonRequest, makeCtx } from "@test/helpers";
import { __queryLog, __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/exercises";

beforeEach(() => __resetDbStub());

describe("exercises POST — auth & body parsing", () => {
  it("redirects to /dashboard when there is no user and the client doesn't accept JSON", async () => {
    const ctx = makeCtx({
      req: new Request(URL, { method: "POST" }),
      locals: { user: null, activeRegistry: null },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 302);
    // Response.redirect produces an absolute URL.
    assertEquals(res.headers.get("location"), "https://test.local/dashboard");
  });

  it("returns 401 JSON when there is no user and the client accepts JSON", async () => {
    const ctx = makeCtx({
      req: new Request(URL, {
        method: "POST",
        headers: { Accept: "application/json" },
      }),
      locals: { user: null, activeRegistry: null },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns a 400 JSON error when the body is declared JSON but fails to parse", async () => {
    const ctx = makeCtx({
      req: new Request(URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "not valid json",
      }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("redirects to /dashboard when JSON parsing fails and the client doesn't accept JSON", async () => {
    const ctx = makeCtx({
      req: new Request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 302);
  });
});

describe("exercises POST — ownership gate (S8)", () => {
  it("returns 403 JSON when the requested registry isn't owned by the user", async () => {
    const ctx = makeCtx({
      req: jsonRequest(
        URL,
        { registryId: "r-other" },
        {
          Accept: "application/json",
        },
      ),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        ownerRegistryIds: new Set(["r1"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("returns 403 JSON when the user is a member of the ACTIVE registry but not its owner", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, {}, { Accept: "application/json" }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        isOwner: false,
        ownerRegistryIds: new Set<string>(),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("redirects when the ownership check fails and the client doesn't accept JSON", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { registryId: "r-other" }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        ownerRegistryIds: new Set(["r1"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 302);
  });
});

describe("exercises POST — empty active short-circuit", () => {
  it("returns JSON with null exercise when there are no active transactions", async () => {
    // getActiveTransactions returns [].
    __setQueryResult({ rows: [] });
    const ctx = makeCtx({
      req: jsonRequest(URL, {}, { Accept: "application/json" }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        ownerRegistryIds: new Set(["r1"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { exercise: null, transactions: [] });
  });

  it("proceeds for an owned non-active registry (empty active → null exercise)", async () => {
    // Owner of both registries requesting a close on the non-active one.
    __setQueryResult({ rows: [] });
    const ctx = makeCtx({
      req: jsonRequest(
        URL,
        { registryId: "r2" },
        {
          Accept: "application/json",
        },
      ),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never, { id: "r2" } as never],
        ownerRegistryIds: new Set(["r1", "r2"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { exercise: null, transactions: [] });
  });

  it("redirects when active is empty and the client doesn't accept JSON", async () => {
    __setQueryResult({ rows: [] });
    const ctx = makeCtx({
      req: jsonRequest(URL, {}),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        ownerRegistryIds: new Set(["r1"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 302);
  });
});

describe("exercises POST — cut with carry-forward ajustes (happy path)", () => {
  it("archives the period and writes one ajuste per outstanding debt", async () => {
    const txRow = {
      id: "t1",
      registry_id: "r1",
      description: "Dinner",
      amount: "100",
      original_amount: "100",
      type: "unico",
      exercise_id: null,
      installment_current: null,
      installment_total: null,
      recurring_disabled: false,
      recurring_group_id: "g1",
      notes: "",
      // u1 paid, split 50/50 with u2 → u2 owes u1 50 → one ajuste expected.
      split_json: {
        splits: [
          { userId: "u1", percentage: 50, amount: 50 },
          { userId: "u2", percentage: 50, amount: 50 },
        ],
      },
      related_transaction_id: null,
      creator_id: "u1",
      user_paid: "u1",
      created_at: "2024-01-15T00:00:00Z",
    };
    const userRow = (id: string) => ({
      id,
      name: `User ${id}`,
      color: "#093eaa",
      email: `${id}@x.test`,
      supabase_auth_id: null,
      created_at: "2024-01-01T00:00:00Z",
    });
    __setQueryResult((text) => {
      if (text.includes("exercise_id IS NULL AND registry_id")) {
        return { rows: [txRow] };
      }
      if (text.includes("JOIN registry_members rm ON rm.user_id")) {
        return { rows: [userRow("u1"), userRow("u2")] };
      }
      if (text.includes("entities_json")) return { rows: [] };
      if (text.includes("WITH active AS")) {
        return {
          rows: [
            {
              id: "ex-1",
              registry_id: "r1",
              start_date: "2024-01-15T00:00:00Z",
              end_date: "2024-01-20T00:00:00Z",
              transaction_count: 1,
              total_amount: "100",
            },
          ],
        };
      }
      if (text.includes("SELECT 1 FROM registry_members")) {
        return { rows: [{ "?column?": 1 }] };
      }
      if (text.includes("INSERT INTO transactions")) {
        return { rows: [{ ...txRow, id: "ajuste-1", type: "ajuste" }] };
      }
      return { rows: [] };
    });

    const ctx = makeCtx({
      req: jsonRequest(URL, {}, { Accept: "application/json" }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        ownerRegistryIds: new Set(["r1"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.exercise.id, "ex-1");
    assertEquals(body.transactions.length, 1); // the u2→u1 debt

    // The ajuste INSERT really ran through the (stubbed) transaction unit.
    const insertCalls = __queryLog.filter((c) => c.text.includes("INSERT INTO transactions"));
    assertEquals(insertCalls.length, 1);
  });

  it("archives without ajustes when balances are settled", async () => {
    const txRow = {
      id: "t1",
      registry_id: "r1",
      description: "Dinner",
      amount: "100",
      original_amount: "100",
      type: "unico",
      exercise_id: null,
      installment_current: null,
      installment_total: null,
      recurring_disabled: false,
      recurring_group_id: "g1",
      notes: "",
      // Fully settled: payer outside the split → no pairwise debt.
      split_json: { splits: [{ userId: "u2", percentage: 100, amount: 100 }] },
      related_transaction_id: null,
      creator_id: "u1",
      user_paid: "u2",
      created_at: "2024-01-15T00:00:00Z",
    };
    __setQueryResult((text) => {
      if (text.includes("exercise_id IS NULL AND registry_id")) {
        return { rows: [txRow] };
      }
      if (text.includes("JOIN registry_members rm ON rm.user_id")) {
        return {
          rows: [
            {
              id: "u1",
              name: "User u1",
              color: "#093eaa",
              email: "u1@x.test",
              supabase_auth_id: null,
              created_at: "2024-01-01T00:00:00Z",
            },
            {
              id: "u2",
              name: "User u2",
              color: "#093eaa",
              email: "u2@x.test",
              supabase_auth_id: null,
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
        };
      }
      if (text.includes("entities_json")) return { rows: [] };
      if (text.includes("WITH active AS")) {
        return {
          rows: [
            {
              id: "ex-2",
              registry_id: "r1",
              start_date: "2024-01-15T00:00:00Z",
              end_date: "2024-01-20T00:00:00Z",
              transaction_count: 1,
              total_amount: "100",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const ctx = makeCtx({
      req: jsonRequest(URL, {}, { Accept: "application/json" }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        ownerRegistryIds: new Set(["r1"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.exercise.id, "ex-2");
    assertEquals(body.transactions, []);
    assertEquals(__queryLog.filter((c) => c.text.includes("INSERT INTO transactions")).length, 0);
  });
});

describe("exercises GET", () => {
  it("returns an empty exercises list when there is no active registry", async () => {
    const ctx = makeCtx({
      req: new Request(URL),
      locals: { activeRegistry: null },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { exercises: [] });
  });
});
