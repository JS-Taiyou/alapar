/**
 * Tests for the default-split route handler.
 *
 * Covers the pre-DB validation logic: body presence, the per-registry
 * ownership gate (B4 — the target registry must be in ownerRegistryIds, not
 * just the active one), the percentage-sum check (±0.01 threshold), and
 * participant-membership validation against the TARGET registry. The store
 * calls (`setDefaultSplit`/`clearDefaultSplitForOwner`) run against the
 * stubbed query, so the happy paths are exercised too.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./default-split";
import { jsonDelete, jsonRequest, makeCtx, mkParticipant } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/registries/default-split";
const participants = [
  mkParticipant("u1", "Alice"),
  mkParticipant("u2", "Bob"),
  mkParticipant("u3", "Carol"),
];

function ownerCtx(req: Request) {
  return makeCtx({
    req,
    locals: {
      user: { id: "u1" } as never,
      isOwner: true,
      participants,
      activeRegistry: { id: "r1" } as never,
      registries: [{ id: "r1" } as never],
      ownerRegistryIds: new Set(["r1"]),
    },
  });
}

function memberCtx(req: Request) {
  return makeCtx({
    req,
    locals: {
      user: { id: "u2" } as never,
      isOwner: false,
      participants,
      activeRegistry: { id: "r1" } as never,
      registries: [{ id: "r1" } as never],
      ownerRegistryIds: new Set<string>(),
    },
  });
}

beforeEach(() => __resetDbStub());

describe("default-split POST", () => {
  it("rejects an invalid body (missing registryId) with 400", async () => {
    const ctx = ownerCtx(jsonRequest(URL, { splits: [] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a non-owner with 403", async () => {
    const ctx = memberCtx(
      jsonRequest(URL, {
        registryId: "r1",
        splits: [{ userId: "u1", percentage: 100 }],
      }),
    );
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("rejects an owner of a DIFFERENT registry with 403 (B4)", async () => {
    // Owning the active registry must not authorize mutating another one.
    const ctx = makeCtx({
      req: jsonRequest(URL, {
        registryId: "r-other",
        splits: [{ userId: "u1", percentage: 100 }],
      }),
      locals: {
        user: { id: "u1" } as never,
        isOwner: true,
        participants,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never, { id: "r-other" } as never],
        ownerRegistryIds: new Set(["r1"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("rejects splits that don't sum to 100 (off by 1) with 400", async () => {
    const ctx = ownerCtx(
      jsonRequest(URL, {
        registryId: "r1",
        splits: [{ userId: "u1", percentage: 99 }],
      }),
    );
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("accepts splits that sum to 100 within the 0.01 tolerance", async () => {
    // setDefaultSplit → getRegistryMemberCount expects rows[0].cnt.
    __setQueryResult(() => ({ rows: [{ cnt: "3" }] }));
    // 33.33 + 33.33 + 33.34 = 100.00 — within tolerance.
    const ctx = ownerCtx(
      jsonRequest(URL, {
        registryId: "r1",
        splits: [
          { userId: "u1", percentage: 33.33 },
          { userId: "u2", percentage: 33.33 },
          { userId: "u3", percentage: 33.34 },
        ],
      }),
    );
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
  });

  it("rejects a split referencing a user not in participants with 400", async () => {
    const ctx = ownerCtx(
      jsonRequest(URL, {
        registryId: "r1",
        splits: [{ userId: "u-unknown", percentage: 100 }],
      }),
    );
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("accepts a valid owner request with percentages summing to 100", async () => {
    __setQueryResult(() => ({ rows: [{ cnt: "3" }] }));
    const ctx = ownerCtx(
      jsonRequest(URL, {
        registryId: "r1",
        splits: [
          { userId: "u1", percentage: 50 },
          { userId: "u2", percentage: 30 },
          { userId: "u3", percentage: 20 },
        ],
      }),
    );
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  });

  it("validates split userIds against the TARGET registry when it isn't the active one (B4)", async () => {
    // The owner owns r2 but it's not active: participants must be fetched,
    // not taken from ctx.state.participants (which describes r1).
    // getUsers returns [] and getEntities returns [] → u1 is not a
    // participant of r2 → 400.
    __setQueryResult(() => ({ rows: [] }));
    const ctx = makeCtx({
      req: jsonRequest(URL, {
        registryId: "r2",
        splits: [{ userId: "u1", percentage: 100 }],
      }),
      locals: {
        user: { id: "u1" } as never,
        isOwner: false,
        participants,
        activeRegistry: { id: "r1" } as never,
        registries: [{ id: "r1" } as never, { id: "r2" } as never],
        ownerRegistryIds: new Set(["r2"]),
      },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });
});

describe("default-split DELETE", () => {
  it("rejects a missing registryId with 400", async () => {
    const ctx = ownerCtx(jsonDelete(URL, {}));
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a non-owner with 403", async () => {
    const ctx = memberCtx(jsonDelete(URL, { registryId: "r1" }));
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("rejects clearing another registry's split with 403 (B4)", async () => {
    const ctx = ownerCtx(jsonDelete(URL, { registryId: "r-other" }));
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("clears the split for an owner and returns ok", async () => {
    const ctx = ownerCtx(jsonDelete(URL, { registryId: "r1" }));
    const res = await handler.DELETE!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  });
});
