/**
 * Tests for the single-transaction route handler (PUT), focused on the S7
 * cross-reference validation: payer/split users must be participants of the
 * transaction's registry, and related/payment transaction ids must resolve
 * inside the same registry.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./[id]";
import { formRequest, makeCtx, mkParticipant } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/transactions/tx-1";
const participants = [mkParticipant("u1"), mkParticipant("u2")];

function userCtx(req: Request) {
  return makeCtx({
    req,
    params: { id: "tx-1" },
    locals: {
      user: { id: "u1" } as never,
      activeRegistry: { id: "r1", name: "R" } as never,
      participants,
    },
  });
}

function txRow(id: string, registryId: string) {
  return {
    id,
    registry_id: registryId,
    description: "Dinner",
    amount: "100",
    original_amount: "100",
    type: "unico",
    exercise_id: null,
    installment_current: null,
    installment_total: null,
    recurring_disabled: false,
    recurring_group_id: "g1",
    notes: "",
    split_json: { splits: [{ userId: "u1", percentage: 100, amount: 100 }] },
    related_transaction_id: null,
    creator_id: "u1",
    user_paid: "u1",
    created_at: "2024-01-01",
  };
}

function validFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    description: "Dinner",
    amount: "100",
    userPaid: "u1",
    splitJson: JSON.stringify({
      splits: [{ userId: "u1", percentage: 100, amount: 100 }],
    }),
    ...overrides,
  };
}

/** Stub getTransactionById (SELECT) + updateTransaction (UPDATE RETURNING). */
function stubTxFound() {
  __setQueryResult((text) => {
    if (text.includes("SELECT * FROM transactions WHERE id = $1")) {
      return { rows: [txRow("tx-1", "r1")] };
    }
    if (text.includes("id = ANY")) {
      return { rows: [txRow("tx-2", "r1")] };
    }
    if (text.includes("UPDATE transactions")) {
      return { rows: [txRow("tx-1", "r1")] };
    }
    return { rows: [] };
  });
}

beforeEach(() => __resetDbStub());

describe("transaction PUT — basics", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = makeCtx({
      req: formRequest(URL, validFields()),
      params: { id: "tx-1" },
      locals: { user: null },
    });
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns 404 when the transaction doesn't exist", async () => {
    __setQueryResult(() => ({ rows: [] }));
    const ctx = userCtx(formRequest(URL, validFields()));
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 404);
  });
});

describe("transaction PUT — cross-reference validation (S7)", () => {
  it("rejects a userPaid that isn't a participant of the registry with 400", async () => {
    stubTxFound();
    const ctx = userCtx(formRequest(URL, validFields({ userPaid: "u-x" })));
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a split userId that isn't a participant of the registry with 400", async () => {
    stubTxFound();
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
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a relatedTransactionId from another registry with 400", async () => {
    __setQueryResult((text) => {
      if (text.includes("SELECT * FROM transactions WHERE id = $1")) {
        return { rows: [txRow("tx-1", "r1")] };
      }
      if (text.includes("id = ANY")) {
        return { rows: [txRow("tx-2", "r-foreign")] };
      }
      return { rows: [] };
    });
    const ctx = userCtx(formRequest(URL, validFields({ relatedTransactionId: "tx-2" })));
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("rejects a transactionPayments expenseId from another registry with 400", async () => {
    __setQueryResult((text) => {
      if (text.includes("SELECT * FROM transactions WHERE id = $1")) {
        return { rows: [txRow("tx-1", "r1")] };
      }
      if (text.includes("id = ANY")) {
        return { rows: [txRow("tx-9", "r-foreign")] };
      }
      return { rows: [] };
    });
    const ctx = userCtx(
      formRequest(
        URL,
        validFields({
          transactionPayments: JSON.stringify([{ expenseId: "tx-9", amount: 50 }]),
        }),
      ),
    );
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 400);
  });

  it("updates and returns 200 when all references stay inside the registry", async () => {
    stubTxFound();
    const ctx = userCtx(formRequest(URL, validFields({ relatedTransactionId: "tx-2" })));
    const res = await handler.PUT!(ctx as never);
    assertEquals(res.status, 200);
  });
});
