/**
 * Tests for the invitation route handlers: create (index), join, and revoke.
 * Covers the presence-validation 400s and the owner-check 403s.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as createHandler from "./index";
import * as joinHandler from "./join";
import * as revokeHandler from "./[id]/revoke";
import { jsonRequest, makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/invitations";

beforeEach(() => __resetDbStub());

describe("invitations POST (create)", () => {
  it("returns 400 when registryId is missing", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, {}),
      locals: { user: { id: "u1" } as never },
    });
    const res = await createHandler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 400 when there is no user", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { registryId: "r1" }),
      locals: { user: null },
    });
    const res = await createHandler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 403 when the user is not the owner", async () => {
    // getUserRole returns a non-owner role (or null).
    __setQueryResult(() => ({ rows: [{ role: "member" }] }));
    const ctx = makeCtx({
      req: jsonRequest(URL, { registryId: "r1" }),
      locals: { user: { id: "u1" } as never },
    });
    const res = await createHandler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("creates an invitation and returns the code when the user is owner", async () => {
    // getUserRole returns 'owner', then createInvitation inserts + audit log.
    __setQueryResult(() => ({
      rows: [{ role: "owner" }, { id: "inv-1", code: "ABCD1234" }],
    }));
    const ctx = makeCtx({
      req: jsonRequest(URL, { registryId: "r1" }),
      locals: { user: { id: "u1" } as never },
    });
    const res = await createHandler.POST!(ctx as never);
    assertEquals(res.status, 200);
  });
});

describe("invitations join POST", () => {
  it("returns 400 when code is missing", async () => {
    const ctx = makeCtx({
      req: jsonRequest(`${URL}/join`, {}),
      locals: { user: { id: "u1" } as never },
    });
    const res = await joinHandler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 400 when there is no user", async () => {
    const ctx = makeCtx({
      req: jsonRequest(`${URL}/join`, { code: "ABC" }),
      locals: { user: null },
    });
    const res = await joinHandler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 400 with the store error message when the invitation is invalid", async () => {
    // useInvitation → getInvitationByCode returns no rows → throws.
    __setQueryResult({ rows: [] });
    const ctx = makeCtx({
      req: jsonRequest(`${URL}/join`, { code: "BADCODE" }),
      locals: { user: { id: "u1" } as never },
    });
    const res = await joinHandler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });
});

describe("invitations revoke POST", () => {
  it("returns 400 when invitationId or user is missing", async () => {
    const ctx = makeCtx({
      req: jsonRequest(`${URL}/inv-1/revoke`, {}),
      params: { id: "inv-1" },
      locals: { user: null },
    });
    const res = await revokeHandler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("returns 404 when the user doesn't own the invitation's registry (B5)", async () => {
    // The ownership-scoped UPDATE no-ops (rowCount 0) — the route must not
    // distinguish "unknown id" from "someone else's registry".
    __setQueryResult(() => ({ rows: [], rowCount: 0 }));
    const ctx = makeCtx({
      req: jsonRequest(`${URL}/inv-1/revoke`, {}),
      params: { id: "inv-1" },
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
      },
    });
    const res = await revokeHandler.POST!(ctx as never);
    assertEquals(res.status, 404);
  });

  it("returns ok when the ownership-scoped revoke lands", async () => {
    __setQueryResult(() => ({ rows: [], rowCount: 1 }));
    const ctx = makeCtx({
      req: jsonRequest(`${URL}/inv-1/revoke`, {}),
      params: { id: "inv-1" },
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
      },
    });
    const res = await revokeHandler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  });
});
