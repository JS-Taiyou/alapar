/**
 * Tests for the `last_modified` stamp bump in store mutations.
 *
 * `lib/db.ts` is redirected to `test/fixtures/db_stub.ts` under the test
 * config, so `withTransaction` runs the unit against the stubbed `query`.
 * These tests assert that every mutation bumps the registry stamp INSIDE its
 * own SQL unit — the guarantee that data and stamp commit atomically (a lost
 * bump makes every cache layer serve pre-mutation rows forever).
 */
import { assertEquals } from "@test/compat";
import { beforeEach, describe, it } from "@test/compat";
import type { Transaction } from "./types";
import { createTransaction, deleteTransaction, updateTransaction } from "./store";
import { __queryLog, __resetDbStub, __setQueryResult } from "@test/fixtures/db_stub";

const TX_ROW = {
  id: "tx-1",
  registry_id: "reg-1",
  description: "Dinner",
  amount: "100.50",
  original_amount: "100.50",
  type: "unico",
  exercise_id: null,
  installment_current: null,
  installment_total: null,
  recurring_disabled: false,
  recurring_group_id: "grp-1",
  notes: "",
  split_json: '{"splits":[{"userId":"u-1","percentage":100,"amount":100.50}]}',
  related_transaction_id: null,
  creator_id: "u-1",
  user_paid: "u-1",
  created_at: "2024-01-15T10:00:00Z",
};

const NEW_TX: Omit<Transaction, "id" | "createdAt"> = {
  registry_id: "reg-1",
  description: "Dinner",
  amount: 100.5,
  originalAmount: 100.5,
  type: "unico",
  exerciseId: null,
  installmentCurrent: null,
  installmentTotal: null,
  recurringDisabled: false,
  recurringGroupId: "grp-1",
  notes: "",
  splitJson: { splits: [{ userId: "u-1", percentage: 100, amount: 100.5 }] },
  relatedTransactionId: null,
  creatorId: "u-1",
  userPaid: "u-1",
};

function stampBumps() {
  return __queryLog.filter((c) => c.text.includes("UPDATE registries SET last_modified"));
}

beforeEach(() => {
  __resetDbStub();
});

describe("createTransaction stamp bump", () => {
  it("bumps the stamp after the INSERT, in the same unit", async () => {
    __setQueryResult((text) => {
      if (text.includes("SELECT 1 FROM registry_members")) {
        return { rows: [{ exists: true }] };
      }
      if (text.includes("INSERT INTO transactions")) {
        return { rows: [TX_ROW] };
      }
      return { rows: [] };
    });

    await createTransaction(NEW_TX, "u-1");

    const bumps = stampBumps();
    assertEquals(bumps.length, 1);
    assertEquals(bumps[0].params, ["reg-1"]);
    // The bump must come after the INSERT it stamps.
    const insertIdx = __queryLog.findIndex((c) => c.text.includes("INSERT INTO transactions"));
    assertEquals(insertIdx !== -1, true);
    assertEquals(__queryLog.indexOf(bumps[0]) > insertIdx, true);
  });

  it("does not bump when membership fails (no mutation happened)", async () => {
    __setQueryResult(() => ({ rows: [] }));

    const tx = await createTransaction(NEW_TX, "u-1");

    assertEquals(tx, null);
    assertEquals(stampBumps().length, 0);
  });
});

describe("updateTransaction stamp bump", () => {
  it("bumps the stamp when the UPDATE matched a row", async () => {
    __setQueryResult((text) => {
      if (text.startsWith("UPDATE transactions")) {
        return { rows: [{ ...TX_ROW, description: "Edited" }] };
      }
      return { rows: [] };
    });

    await updateTransaction("tx-1", { description: "Edited" }, "u-1");

    const bumps = stampBumps();
    assertEquals(bumps.length, 1);
    assertEquals(bumps[0].params, ["reg-1"]);
  });

  it("does not bump when the UPDATE matched nothing (forbidden/id)", async () => {
    __setQueryResult(() => ({ rows: [] }));

    await updateTransaction("tx-1", { description: "Edited" }, "u-1");

    assertEquals(stampBumps().length, 0);
  });
});

describe("deleteTransaction stamp bump", () => {
  it("bumps the stamp only when a row was deleted", async () => {
    __setQueryResult((text) => {
      if (text.startsWith("DELETE FROM transactions")) {
        return { rows: [{ registry_id: "reg-1" }], rowCount: 1 };
      }
      return { rows: [] };
    });

    const deleted = await deleteTransaction("tx-1", "u-1");

    assertEquals(deleted, true);
    const bumps = stampBumps();
    assertEquals(bumps.length, 1);
    assertEquals(bumps[0].params, ["reg-1"]);
  });

  it("does not bump when nothing was deleted", async () => {
    __setQueryResult(() => ({ rows: [], rowCount: 0 }));

    const deleted = await deleteTransaction("tx-1", "u-1");

    assertEquals(deleted, false);
    assertEquals(stampBumps().length, 0);
  });
});
