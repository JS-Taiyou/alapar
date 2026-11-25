/**
 * Tests for the dashboard snapshot route: what it returns when there is
 * nothing to show, and that it carries the book's line for leftover cents.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import type { Registry } from "@/lib/types";
import * as handler from "./dashboard";
import { makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/dashboard?registryId=r1";

function registry(overrides: Partial<Registry> = {}): Registry {
  return {
    id: "r1",
    name: "Housemates",
    isDefault: false,
    latestAccessed: new Date(),
    defaultSplit: null,
    defaultSplitMemberCount: null,
    lastModified: null,
    remainderQueue: [],
    ...overrides,
  };
}

beforeEach(() => __resetDbStub());

describe("dashboard GET", () => {
  it("returns an empty snapshot, line included, when nobody is signed in", async () => {
    const res = await handler.GET!(makeCtx({ req: new Request(URL) }) as never);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).remainderQueue, []);
  });

  it("carries the book's line for leftover cents", async () => {
    // No cached rows and no balance rows: both fall back to empty results.
    __setQueryResult(() => ({ rows: [] }));
    const ctx = makeCtx({
      req: new Request(URL),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: registry({ remainderQueue: ["u2", "u1"] }),
        registries: [registry({ remainderQueue: ["u2", "u1"] })],
        participants: [],
        entities: [],
      },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).remainderQueue, ["u2", "u1"]);
  });

  it("returns an empty line for a book of another kind of visitor", async () => {
    // A signed-in user whose active book is not the one asked for still gets
    // the line of the book asked for.
    __setQueryResult(() => ({ rows: [] }));
    const ctx = makeCtx({
      req: new Request(URL),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: null,
        registries: [registry({ remainderQueue: ["u3"] })],
        participants: [],
        entities: [],
      },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals((await res.json()).remainderQueue, ["u3"]);
  });
});
