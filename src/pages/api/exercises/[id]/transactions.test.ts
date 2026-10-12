/**
 * Tests for the exercise-transactions route handler (B1): the exercise must
 * belong to a registry the user is a member of, otherwise 404.
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import * as handler from "./transactions";
import { makeCtx } from "@test/helpers";
import { __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const URL = "https://test.local/api/exercises/ex-1/transactions";
const user = { id: "u1" } as never;

beforeEach(() => __resetDbStub());

describe("exercise transactions GET", () => {
  it("returns 401 when there is no user", async () => {
    const ctx = makeCtx({
      req: new Request(URL),
      params: { id: "ex-1" },
      locals: { user: null },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 401);
  });

  it("returns 404 when the exercise belongs to a registry the user isn't in (B1)", async () => {
    // The membership-scoped exercise lookup returns no rows.
    __setQueryResult(() => ({ rows: [] }));
    const ctx = makeCtx({
      req: new Request(URL),
      params: { id: "ex-1" },
      locals: { user },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 404);
  });

  it("returns the transactions when the exercise is in a member registry", async () => {
    __setQueryResult((text) => {
      if (text.includes("FROM exercises e")) {
        return {
          rows: [
            {
              id: "ex-1",
              registry_id: "r1",
              start_date: "2024-01-01",
              end_date: "2024-02-01",
              transaction_count: 1,
              total_amount: "10",
            },
          ],
        };
      }
      if (text.includes("FROM transactions t")) {
        return {
          rows: [
            {
              id: "tx-1",
              registry_id: "r1",
              description: "Dinner",
              amount: "10",
              original_amount: "10",
              type: "unico",
              exercise_id: "ex-1",
              recurring_group_id: "g1",
              split_json: { splits: [] },
              user_paid: "u1",
              created_at: "2024-01-15",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const ctx = makeCtx({
      req: new Request(URL),
      params: { id: "ex-1" },
      locals: { user },
    });
    const res = await handler.GET!(ctx as never);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { transactions: { id: string }[] };
    assertEquals(body.transactions.length, 1);
    assertEquals(body.transactions[0].id, "tx-1");
  });
});
