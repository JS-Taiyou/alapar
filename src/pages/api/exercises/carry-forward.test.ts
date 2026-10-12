/**
 * Tests for the carry-forward route handler (B3): every source transaction
 * must live in a registry the caller belongs to (not just items[0]), and
 * items/quantity are capped against batch-clone DoS.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./carry-forward";
import { jsonRequest, makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/exercises/carry-forward";
const user = { id: "u1" } as never;

function memberCtx(req: Request) {
  return makeCtx({
    req,
    locals: { user, registries: [{ id: "r1" } as never] },
  });
}

/** A minimal transaction row for the stubbed getTransactionsByIds. */
function txRow(id: string, registryId: string) {
  return {
    id,
    registry_id: registryId,
    description: "Rent",
    amount: "100",
    original_amount: "100",
    type: "recurrente",
    exercise_id: "ex-1",
    installment_current: null,
    installment_total: null,
    recurring_disabled: false,
    recurring_group_id: "g1",
    notes: "",
    split_json: { splits: [] },
    related_transaction_id: null,
    creator_id: "u1",
    user_paid: "u1",
    created_at: "2024-01-01",
  };
}

beforeEach(() => __resetDbStub());

describe("carry-forward POST — caps (B3 DoS)", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = makeCtx({
      req: jsonRequest(URL, { items: [{ id: "t1" }] }),
      locals: { user: null },
    });
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns created 0 for an empty items list", async () => {
    const ctx = memberCtx(jsonRequest(URL, { items: [] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { created: 0 });
  });

  it("rejects a non-array items with 400", async () => {
    const ctx = memberCtx(jsonRequest(URL, { items: "t1" }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects more than 100 items with 400", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ id: `t${i}` }));
    const ctx = memberCtx(jsonRequest(URL, { items }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a quantity above 60 with 400", async () => {
    const ctx = memberCtx(jsonRequest(URL, { items: [{ id: "t1", quantity: 61 }] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a quantity below 1 with 400", async () => {
    const ctx = memberCtx(jsonRequest(URL, { items: [{ id: "t1", quantity: 0 }] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });
});

describe("carry-forward POST — source registry checks (B3)", () => {
  it("returns 404 when a source transaction doesn't exist", async () => {
    __setQueryResult(() => ({ rows: [] }));
    const ctx = memberCtx(jsonRequest(URL, { items: [{ id: "t1" }] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 404);
  });

  it("returns 403 when ANY source lives in a registry the caller isn't in", async () => {
    // First item is in the member registry r1, second is foreign — the old
    // code only checked items[0].
    __setQueryResult((text) => {
      if (text.includes("id = ANY")) {
        return { rows: [txRow("t1", "r1"), txRow("t2", "r-foreign")] };
      }
      return { rows: [] };
    });
    const ctx = memberCtx(jsonRequest(URL, { items: [{ id: "t1" }, { id: "t2" }] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });

  it("rejects quantity > 1 on a recurrente source (silently ignored before)", async () => {
    __setQueryResult((text) => {
      if (text.includes("id = ANY")) return { rows: [txRow("t1", "r1")] };
      return { rows: [] };
    });
    const ctx = memberCtx(jsonRequest(URL, { items: [{ id: "t1", quantity: 3 }] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(typeof body.error, "string");
  });

  it("accepts quantity > 1 on a parcialidad source", async () => {
    __setQueryResult((text) => {
      if (text.includes("id = ANY")) {
        return {
          rows: [
            {
              ...txRow("t1", "r1"),
              type: "parcialidad",
              installment_current: 3,
              installment_total: 12,
            },
          ],
        };
      }
      if (text.includes("INSERT INTO transactions")) {
        return { rows: [{ ...txRow("clone-1", "r1"), id: "clone-1" }] };
      }
      return { rows: [] };
    });
    const ctx = memberCtx(jsonRequest(URL, { items: [{ id: "t1", quantity: 3 }] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
  });

  it("clones and returns the created count when every source is in a member registry", async () => {
    __setQueryResult((text) => {
      if (text.includes("id = ANY")) return { rows: [txRow("t1", "r1")] };
      if (text.includes("INSERT INTO transactions")) {
        return { rows: [{ ...txRow("clone-1", "r1"), id: "clone-1" }] };
      }
      return { rows: [] };
    });
    const ctx = memberCtx(jsonRequest(URL, { items: [{ id: "t1" }] }));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { created: 1 });
  });
});
