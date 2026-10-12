/**
 * Tests for the single-registry route handler (PATCH rename, DELETE with the
 * transaction-count guard). Both are owner-only (S8).
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./[id]";
import { jsonDelete, jsonPatch, makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/registries/r1";

function ownerCtx(req: Request) {
  return makeCtx({
    req,
    params: { id: "r1" },
    locals: {
      user: { id: "u1" } as never,
      registries: [{ id: "r1" } as never],
      isOwner: true,
      ownerRegistryIds: new Set(["r1"]),
    },
  });
}

/** A member of r1 who is NOT its owner. */
function memberNotOwnerCtx(req: Request) {
  return makeCtx({
    req,
    params: { id: "r1" },
    locals: {
      user: { id: "u1" } as never,
      registries: [{ id: "r1" } as never],
      isOwner: false,
      ownerRegistryIds: new Set<string>(),
    },
  });
}

beforeEach(() => __resetDbStub());

describe("registry PATCH (rename)", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = makeCtx({
      req: jsonPatch(URL, { name: "X" }),
      params: { id: "r1" },
      locals: { user: null, registries: [{ id: "r1" } as never] },
    });
    const res = await handler.PATCH!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns 403 when the user is not a member of the registry", async () => {
    const ctx = makeCtx({
      req: jsonPatch(URL, { name: "X" }),
      params: { id: "r1" },
      locals: {
        user: { id: "u1" } as never,
        registries: [{ id: "r2" } as never],
      },
    });
    const res = await handler.PATCH!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("returns 403 when the user is a member but not the owner (S8)", async () => {
    const ctx = memberNotOwnerCtx(jsonPatch(URL, { name: "X" }));
    const res = await handler.PATCH!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("returns 400 when the name is missing or blank", async () => {
    const ctx = ownerCtx(jsonPatch(URL, { name: "   " }));
    const res = await handler.PATCH!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("renames and returns 200 when the owner and registry exist", async () => {
    // renameRegistry → isMemberOfRegistry (row) + UPDATE RETURNING * (row).
    __setQueryResult(() => ({
      rows: [
        {
          id: "r1",
          name: "New",
          is_default: false,
          latest_accessed: "2024-01-01",
          default_split_json: null,
          default_split_member_count: null,
          last_modified: null,
        },
      ],
    }));
    const ctx = ownerCtx(jsonPatch(URL, { name: "New Name" }));
    const res = await handler.PATCH!(ctx as never);
    assertEquals(res.status, 200);
  });
});

describe("registry DELETE", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = makeCtx({
      req: jsonDelete(URL, {}),
      params: { id: "r1" },
      locals: { user: null, registries: [{ id: "r1" } as never] },
    });
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns 403 when the user is not a member", async () => {
    const ctx = makeCtx({
      req: jsonDelete(URL, {}),
      params: { id: "r1" },
      locals: {
        user: { id: "u1" } as never,
        registries: [{ id: "r2" } as never],
      },
    });
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("returns 403 when the user is a member but not the owner (S8)", async () => {
    const ctx = memberNotOwnerCtx(jsonDelete(URL, {}));
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("returns 409 when the registry has transactions", async () => {
    // getTransactionCount returns cnt > 0.
    __setQueryResult(() => ({ rows: [{ cnt: "5" }] }));
    const ctx = ownerCtx(jsonDelete(URL, {}));
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 409);
  });

  it("returns 204 when the owner deletes an empty registry", async () => {
    // getTransactionCount → 0, then the ownership-scoped DELETE → rowCount 1.
    __setQueryResult((text) => {
      if (text.includes("COUNT(*)")) {
        return { rows: [{ cnt: "0" }] };
      }
      return { rows: [], rowCount: 1 };
    });
    const ctx = ownerCtx(jsonDelete(URL, {}));
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 204);
  });
});
