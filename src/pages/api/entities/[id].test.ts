/**
 * Tests for the single-entity route handler (PUT rename, DELETE with the
 * active-transaction guard).
 *
 * Note: both "entity not found" and "entity has active transactions" cause
 * store functions to return a falsy result, so the handler maps both to the
 * same status in some cases (DELETE → 409; PUT → 404). These tests lock that.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./[id]";
import { jsonDelete, jsonRequest, makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/entities/e-1";
const user = { id: "u1" } as never;

beforeEach(() => __resetDbStub());

describe("entity PUT (rename)", () => {
  it("rejects an anonymous request with 401", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "X" }),
      params: { id: "e-1" },
      locals: { user: null },
    });
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("rejects a missing name with 400", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "" }),
      params: { id: "e-1" },
      locals: { user, activeRegistry: { id: "r1" } as never },
    });
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 400 when there is no active registry", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "X" }),
      params: { id: "e-1" },
      locals: { user, activeRegistry: null },
    });
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 404 when the entity does not exist", async () => {
    // updateEntity → getEntities returns [], findIndex → -1 → undefined.
    __setQueryResult(() => ({ rows: [] }));
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "New Name" }),
      params: { id: "e-1" },
      locals: { user, activeRegistry: { id: "r1" } as never },
    });
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 404);
  });

  it("renames and returns 200 when the entity exists", async () => {
    // getEntities returns the entity row so updateEntity finds it; the
    // membership-scoped UPDATE then gets rowCount 1 from the same stub.
    __setQueryResult(() => ({
      rows: [{ entities_json: [{ id: "e-1", name: "Old", color: "#000" }] }],
    }));
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "New Name" }),
      params: { id: "e-1" },
      locals: { user, activeRegistry: { id: "r1" } as never },
    });
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 200);
  });
});

describe("entity DELETE", () => {
  it("rejects an anonymous request with 401", async () => {
    const ctx = makeCtx({
      req: jsonDelete(URL, {}),
      params: { id: "e-1" },
      locals: { user: null },
    });
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns 400 when there is no active registry", async () => {
    const ctx = makeCtx({
      req: jsonDelete(URL, {}),
      params: { id: "e-1" },
      locals: { user, activeRegistry: null },
    });
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 409 when the entity has active transactions", async () => {
    // deleteEntity's pre-check query finds a referencing transaction → false.
    __setQueryResult(() => ({ rows: [{ id: "tx-1" }] }));
    const ctx = makeCtx({
      req: jsonDelete(URL, {}),
      params: { id: "e-1" },
      locals: { user, activeRegistry: { id: "r1" } as never },
    });
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 409);
  });

  it("returns 204 when the entity is deleted successfully", async () => {
    // deleteEntity makes 3 sequential queries: a tx-check (SELECT 1 FROM
    // transactions...), getEntities (SELECT entities_json...), and a
    // membership-scoped UPDATE. Return empty rows for the tx-check, the
    // entity for getEntities, and rowCount 1 for the UPDATE.
    __setQueryResult((text) => {
      if (text.includes("SELECT 1 FROM transactions")) return { rows: [] };
      if (text.includes("SELECT entities_json")) {
        return {
          rows: [{ entities_json: [{ id: "e-1", name: "X", color: "#000" }] }],
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const ctx = makeCtx({
      req: jsonDelete(URL, {}),
      params: { id: "e-1" },
      locals: { user, activeRegistry: { id: "r1" } as never },
    });
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 204);
  });
});
