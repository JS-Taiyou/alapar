/**
 * Tests for the entities collection route handler (POST validation + membership,
 * GET membership check).
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./index";
import { jsonRequest, makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/entities";
const user = { id: "u1" } as never;

beforeEach(() => __resetDbStub());

describe("entities POST", () => {
  it("rejects an anonymous request with 401", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "Landlord" }),
      locals: { user: null },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("rejects a missing name with 400", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "" }),
      locals: { user },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a whitespace-only name with 400", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "   " }),
      locals: { user },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a request with no active registry and no registryId with 400", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "Landlord" }),
      locals: { user, activeRegistry: null, registries: [] },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a non-member of the registry with 403", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { name: "Landlord", registryId: "r1" }),
      locals: { user, registries: [{ id: "r2" } as never] },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("creates an entity and returns 201 for a member", async () => {
    // createEntity → getEntities (SELECT entities_json) returns [] first,
    // then the membership-scoped UPDATE (rowCount 1).
    __setQueryResult(() => ({ rows: [], rowCount: 1 }));
    const ctx = makeCtx({
      req: jsonRequest(URL, {
        name: "Landlord",
        registryId: "r1",
        color: "#999",
      }),
      locals: { user, registries: [{ id: "r1" } as never] },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 201);
  });
});

describe("entities GET", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = makeCtx({
      req: new Request(URL),
      locals: { user: null },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns an empty list when no registryId is resolvable", async () => {
    const ctx = makeCtx({
      req: new Request(URL),
      locals: { user, activeRegistry: null },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), []);
  });

  it("rejects a registryId the user is not a member of with 403 (S6)", async () => {
    const ctx = makeCtx({
      req: new Request(`${URL}?registryId=r-other`),
      locals: { user, registries: [{ id: "r1" } as never] },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("returns the entities for a member registry", async () => {
    __setQueryResult(() => ({
      rows: [
        {
          entities_json: [{ id: "e-1", name: "Landlord", color: "#123" }],
        },
      ],
    }));
    const ctx = makeCtx({
      req: new Request(`${URL}?registryId=r1`),
      locals: { user, registries: [{ id: "r1" } as never] },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), [{ id: "e-1", name: "Landlord", color: "#123" }]);
  });
});
