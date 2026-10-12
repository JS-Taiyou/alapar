/**
 * Tests for the stamp route handler (N14): switching the active registry is a
 * side effect, so the route is POST-only — GET gets a 405.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./[id]";
import { makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/stamp/r1";

beforeEach(() => __resetDbStub());

describe("stamp GET", () => {
  it("returns 405 (side effects require POST)", async () => {
    const ctx = makeCtx({
      req: new Request(URL),
      params: { id: "r1" },
      locals: { user: { id: "u1" } as never },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "POST");
  });
});

describe("stamp POST", () => {
  it("returns 400 when user or registry id is missing", async () => {
    const ctx = makeCtx({
      req: new Request(URL, { method: "POST" }),
      params: { id: "r1" },
      locals: { user: null },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 403 when the user is not a member", async () => {
    __setQueryResult(() => ({ rows: [] }));
    const ctx = makeCtx({
      req: new Request(URL, { method: "POST" }),
      params: { id: "r1" },
      locals: { user: { id: "u1" } as never },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("sets the active registry and returns the stamp for a member", async () => {
    __setQueryResult((text) => {
      if (text.includes("FROM registry_members")) return { rows: [{ "?": 1 }] };
      if (text.includes("last_modified")) {
        return { rows: [{ last_modified: "2024-06-01T00:00:00Z" }] };
      }
      return { rows: [] };
    });
    const ctx = makeCtx({
      req: new Request(URL, { method: "POST" }),
      params: { id: "r1" },
      locals: { user: { id: "u1" } as never },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { lastModified: string | null };
    assertEquals(body.lastModified, "2024-06-01T00:00:00.000Z");
  });
});
