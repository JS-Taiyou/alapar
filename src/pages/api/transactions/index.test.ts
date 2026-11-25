/**
 * Tests for the transactions collection route handler.
 *
 * Focuses on the POST field-validation matrix (all the 400/401 paths that run
 * before createTransaction) and the GET ETag 304 short-circuit. The store
 * calls run against the stubbed query.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./index";
import { formRequest, makeCtx, mkParticipant } from "@test/helpers";
import { __queryLog, __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/transactions";
const participants = [mkParticipant("u1"), mkParticipant("u2")];

function userCtx(req: Request) {
  return makeCtx({
    req,
    locals: {
      user: { id: "u1" } as never,
      activeRegistry: { id: "r1", name: "R" } as never,
      participants,
    },
  });
}

function anonCtx(req: Request) {
  return makeCtx({ req, locals: { user: null } });
}

function validFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    description: "Dinner",
    amount: "100",
    userPaid: "u1",
    registryId: "r1",
    splitJson: JSON.stringify({
      splits: [{ userId: "u1", percentage: 100, amount: 100 }],
    }),
    ...overrides,
  };
}

beforeEach(() => __resetDbStub());

describe("transactions POST — auth", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = anonCtx(formRequest(URL, validFields()));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 401);
  });
});

describe("transactions POST — field validation", () => {
  it("rejects a missing description with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ description: "" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a whitespace-only description with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ description: "   " })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a missing amount with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ amount: "" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a non-numeric amount with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ amount: "abc" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects Infinity from a huge amount with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ amount: "Infinity" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a missing userPaid with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ userPaid: "" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a missing registryId with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ registryId: "" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects an invalid transactionPayments JSON with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ transactionPayments: "not-json" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects an invalid splitJson with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ splitJson: "not-json" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });
});

describe("transactions POST — happy path", () => {
  it("creates a transaction and returns 200 when membership check passes", async () => {
    // createTransaction → isMemberOfRegistry (expects a row), then INSERT RETURNING *.
    __setQueryResult(() => ({ rows: [{ id: "tx-new" }] }));
    const ctx = userCtx(formRequest(URL, validFields()));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
  });

  it("returns 403 when the user is not a member of the registry", async () => {
    // isMemberOfRegistry returns 0 rows → createTransaction returns null → 403.
    __setQueryResult({ rows: [] });
    const ctx = userCtx(formRequest(URL, validFields()));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 403);
  });
});

describe("transactions POST — cross-reference validation (S7)", () => {
  it("rejects a userPaid that isn't a participant of the registry with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ userPaid: "u-x" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a split userId that isn't a participant of the registry with 400", async () => {
    const ctx = userCtx(
      formRequest(
        URL,
        validFields({
          splitJson: JSON.stringify({
            splits: [{ userId: "u-x", percentage: 100, amount: 100 }],
          }),
        }),
      ),
    );
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a relatedTransactionId from another registry with 400", async () => {
    __setQueryResult((text) => {
      if (text.includes("id = ANY")) {
        return { rows: [{ id: "tx-2", registry_id: "r2" }] };
      }
      return { rows: [{ id: "tx-new" }] };
    });
    const ctx = userCtx(formRequest(URL, validFields({ relatedTransactionId: "tx-2" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects an unknown relatedTransactionId with 400", async () => {
    __setQueryResult(() => ({ rows: [] }));
    const ctx = userCtx(formRequest(URL, validFields({ relatedTransactionId: "tx-ghost" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a transactionPayments expenseId from another registry with 400", async () => {
    __setQueryResult((text) => {
      if (text.includes("id = ANY")) {
        return { rows: [{ id: "tx-9", registry_id: "r2" }] };
      }
      return { rows: [{ id: "tx-new" }] };
    });
    const ctx = userCtx(
      formRequest(
        URL,
        validFields({
          transactionPayments: JSON.stringify([{ expenseId: "tx-9", amount: 50 }]),
        }),
      ),
    );
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a non-array transactionPayments JSON with 400", async () => {
    const ctx = userCtx(formRequest(URL, validFields({ transactionPayments: '{"a":1}' })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("accepts references inside the same registry", async () => {
    __setQueryResult((text) => {
      if (text.includes("id = ANY")) {
        return { rows: [{ id: "tx-2", registry_id: "r1" }] };
      }
      return { rows: [{ id: "tx-new" }] };
    });
    const ctx = userCtx(formRequest(URL, validFields({ relatedTransactionId: "tx-2" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
  });
});

describe("transactions GET", () => {
  it("returns an empty list when there is no active registry", async () => {
    const ctx = makeCtx({
      req: new Request(URL),
      locals: { activeRegistry: null },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { transactions: [] });
  });

  it("returns 304 when If-None-Match matches the generated ETag", async () => {
    // First request to capture the ETag, then replay it.
    __setQueryResult(() => ({ rows: [] }));
    const ctx1 = makeCtx({
      req: new Request(URL),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        participants,
      },
    });
    const res1 = await handler.GET!(ctx1 as never);
    const etag = res1.headers.get("ETag")!;

    const ctx2 = makeCtx({
      req: new Request(URL, { headers: { "If-None-Match": etag } }),
      locals: {
        user: { id: "u1" } as never,
        activeRegistry: { id: "r1" } as never,
        participants,
      },
    });
    const res2 = await handler.GET!(ctx2 as never);
    assertEquals(res2.status, 304);
  });
});

describe("transactions POST — the book's line for leftover cents", () => {
  // $10.11 between two members: the form had the cent on u2.
  const twoWay = JSON.stringify({
    splits: [
      { userId: "u1", percentage: 50, amount: 5.05 },
      { userId: "u2", percentage: 50, amount: 5.06 },
    ],
  });
  const fields = (overrides: Record<string, string> = {}) =>
    validFields({ amount: "10.11", splitJson: twoWay, ...overrides });

  /** The two-member book with the line `line`; the INSERT returns `row`. */
  function stubLine(
    line: string[],
    row: Record<string, unknown> = { id: "tx-new", registry_id: "r1" },
  ) {
    __setQueryResult((text) => {
      if (text.includes("SELECT 1 FROM registry_members")) return { rows: [{ exists: true }] };
      if (text.includes("remainder_queue = remainder_queue")) {
        return { rows: [{ remainder_queue: line }] };
      }
      return { rows: [row] };
    });
  }
  const lineWrites = () =>
    __queryLog.filter((c) => c.text.includes("UPDATE registries SET remainder_queue = $2"));
  const storedSplit = () =>
    JSON.parse(
      String(__queryLog.find((c) => c.text.includes("INSERT INTO transactions"))?.params[11]),
    );

  it("rejects a split mode the server does not know", async () => {
    const ctx = userCtx(formRequest(URL, fields({ splitMode: "coin-toss" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("deals an Auto split by the line, not by the cents the form sent, and returns the line", async () => {
    stubLine([]);
    const ctx = userCtx(formRequest(URL, fields({ splitMode: "auto" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(storedSplit(), {
      mode: "auto",
      splits: [
        { userId: "u1", percentage: 50, amount: 5.06 },
        { userId: "u2", percentage: 50, amount: 5.05 },
      ],
    });
    assertEquals(lineWrites()[0]?.params, ["r1", '["u1"]']);
    assertEquals((await res.json()).remainderQueue, ["u1"]);
  });

  it("finds that member at the back on the next save", async () => {
    stubLine(["u1"]);
    const ctx = userCtx(formRequest(URL, fields({ splitMode: "auto" })));
    const res = await handler.POST!(ctx as never);
    assertEquals(
      storedSplit().splits.map((s: { amount: number }) => s.amount),
      [5.05, 5.06],
    );
    assertEquals((await res.json()).remainderQueue, ["u1", "u2"]);
  });

  it("leaves the line alone when the form sends no mode", async () => {
    stubLine(["u2", "u1"]);
    const ctx = userCtx(formRequest(URL, fields()));
    const res = await handler.POST!(ctx as never);
    assertEquals(res.status, 200);
    assertEquals(
      __queryLog.some((c) => c.text.includes("remainder_queue")),
      false,
    );
    assertEquals(storedSplit(), JSON.parse(twoWay));
    assertEquals("remainderQueue" in (await res.json()), false);
  });
});
