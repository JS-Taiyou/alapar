/**
 * Tests for the exercises collection route handler.
 *
 * The POST handler delegates to the perform_corte() PL/pgSQL function
 * (db/perform_corte.sql) — ONE query instead of the JS loop. These tests
 * cover the pre-DB validation/branching (auth, ownership, body parsing)
 * and the perform_corte call + response formatting.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./index";
import { jsonRequest, makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

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
      req: jsonRequest(URL, { registryId: "r-other" }, { Accept: "application/json" }),
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

describe("exercises POST — perform_corte delegation", () => {
  const corteResult = {
    out_exercise_id: "ex-1",
    out_exercise_start: "2024-01-15T00:00:00Z",
    out_exercise_end: "2024-01-20T00:00:00Z",
    out_tx_count: "3",
    out_total_amount: "120.00",
    out_adjustments: 2,
  };

  it("returns JSON with exercise and adjustment count when perform_corte succeeds", async () => {
    __setQueryResult({ rows: [corteResult] });
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
    assertEquals(body.exercise.transaction_count, 3);
    assertEquals(body.adjustments, 2);
  });

  it("redirects after a successful corte when the client doesn't accept JSON", async () => {
    __setQueryResult({ rows: [corteResult] });
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

  it("returns null exercise JSON when perform_corte raises no_active_transactions", async () => {
    __setQueryResult(() => {
      throw new Error("ERROR: no_active_transactions");
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
    assertEquals(await res.json(), { exercise: null, transactions: [] });
  });

  it("returns 403 when perform_corte raises not_owner", async () => {
    __setQueryResult(() => {
      throw new Error("ERROR: not_owner");
    });
    const ctx = makeCtx({
      req: jsonRequest(URL, {}, { Accept: "application/json" }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never],
        ownerRegistryIds: new Set(["r1"]), // JS guard passes; DB guard rejects
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("passes the correct registryId and userId to perform_corte", async () => {
    let capturedParams: unknown[] = [];
    __setQueryResult((text, params) => {
      if (text.includes("perform_corte")) {
        capturedParams = params ?? [];
      }
      return { rows: [corteResult] };
    });
    const ctx = makeCtx({
      req: jsonRequest(URL, { registryId: "r-custom" }, {}),
      locals: {
        user: { id: "u9" } as never,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never, { id: "r-custom" } as never],
        ownerRegistryIds: new Set(["r1", "r-custom"]),
      },
    });
    await handler.POST!(ctx as never);
    assertEquals(capturedParams[0], "r-custom");
    assertEquals(capturedParams[1], "u9");
  });
});
