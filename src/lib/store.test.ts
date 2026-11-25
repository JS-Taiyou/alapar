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
import type { Transaction, TransactionSplit } from "./types";
import {
  batchCloneTransactions,
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "./store";
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
      if (text.includes("FOR UPDATE")) {
        return { rows: [TX_ROW] };
      }
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

// ---------------------------------------------------------------------------
// The book's line for leftover cents
// ---------------------------------------------------------------------------

/**
 * The server deals every Auto / Porcentaje split against the book's line
 * (`resolveTransactionSplit`), under a lock on the line, inside the write's
 * own SQL unit. These tests pin the order of the statements and the split
 * that reaches `split_json`; the arithmetic itself is covered in
 * `splits.test.ts` and `calculations.test.ts`.
 */
describe("the book's line for leftover cents", () => {
  /** $10.11 between two members: one cent cannot be divided. */
  const split = (first: number, second: number) => ({
    splits: [
      { userId: "u-1", percentage: 50, amount: first },
      { userId: "u-2", percentage: 50, amount: second },
    ],
  });
  const storedRow = (overrides: Record<string, unknown> = {}) => ({ ...TX_ROW, ...overrides });
  const calls = (fragment: string) => __queryLog.filter((c) => c.text.includes(fragment));
  const json = (value: unknown) => JSON.parse(String(value));

  /** A two-member book whose line is `line`; every write returns `row`. */
  function stubBook(line: string[], stored: unknown = TX_ROW.split_json) {
    __setQueryResult((text) => {
      if (text.includes("SELECT 1 FROM registry_members")) return { rows: [{ exists: true }] };
      if (text.includes("remainder_queue = remainder_queue")) {
        return { rows: [{ remainder_queue: line }] };
      }
      if (text.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              registry_id: "reg-1",
              type: "unico",
              original_amount: "10.11",
              split_json: stored,
            },
          ],
        };
      }
      if (text.includes("INSERT INTO transactions")) return { rows: [storedRow()] };
      if (text.startsWith("UPDATE transactions")) return { rows: [storedRow()] };
      return { rows: [] };
    });
  }

  const newTx = (splitJson: ReturnType<typeof split>, type: Transaction["type"] = "unico") => ({
    ...NEW_TX,
    amount: 10.11,
    originalAmount: 10.11,
    type,
    splitJson,
  });

  const dealtParams = () =>
    calls("INSERT INTO transactions").flatMap((c) =>
      c.params.filter((p) => String(p).includes("splits")),
    );

  it("a save with a mode locks the line before it writes anything", async () => {
    stubBook([]);
    await createTransaction({ ...newTx(split(5.05, 5.06)), splitMode: "auto" }, "u-1");
    const lock = __queryLog.findIndex((c) => c.text.includes("remainder_queue = remainder_queue"));
    const insert = __queryLog.findIndex((c) => c.text.includes("INSERT INTO transactions"));
    assertEquals(lock !== -1 && lock < insert, true);
    assertEquals(calls("UPDATE registries SET last_modified").length, 1);
  });

  it("holds the line with a write, which no result cache can answer for the database", async () => {
    // Hyperdrive caches read-only results and keeps them across writes; it
    // never caches a write. The lock must therefore not become a SELECT.
    stubBook(["u-2"]);
    await createTransaction({ ...newTx(split(5.05, 5.06)), splitMode: "auto" }, "u-1");
    const lock = __queryLog.find((c) => c.text.includes("remainder_queue = remainder_queue"));
    assertEquals(
      lock?.text.startsWith("UPDATE registries SET remainder_queue = remainder_queue"),
      true,
    );
    assertEquals(lock?.text.endsWith("RETURNING remainder_queue"), true);
    assertEquals(lock?.params, ["reg-1"]);
  });

  it("deals the cent by the line, not by what the form sent, and writes the line it leaves", async () => {
    stubBook([]);
    // The form had the cent on u-2; an empty line gives the first turn to u-1.
    const tx = await createTransaction({ ...newTx(split(5.05, 5.06)), splitMode: "auto" }, "u-1");
    assertEquals(json(dealtParams()[0]), {
      mode: "auto",
      splits: [
        { userId: "u-1", percentage: 50, amount: 5.06 },
        { userId: "u-2", percentage: 50, amount: 5.05 },
      ],
    });
    assertEquals(calls("UPDATE registries SET remainder_queue = $2")[0]?.params, [
      "reg-1",
      '["u-1"]',
    ]);
    assertEquals(tx?.remainderQueue, ["u-1"]);
  });

  it("the next save finds that member at the back and gives the cent to the other", async () => {
    stubBook(["u-1"]);
    const tx = await createTransaction({ ...newTx(split(5.06, 5.05)), splitMode: "auto" }, "u-1");
    assertEquals(json(dealtParams()[0]).splits, [
      { userId: "u-1", percentage: 50, amount: 5.05 },
      { userId: "u-2", percentage: 50, amount: 5.06 },
    ]);
    assertEquals(tx?.remainderQueue, ["u-1", "u-2"]);
  });

  it("does not rewrite a line that did not move", async () => {
    stubBook(["u-1", "u-2"]);
    // $10.00 divides exactly: nothing is left over.
    await createTransaction(
      { ...newTx(split(5, 5), "unico"), originalAmount: 10, amount: 10, splitMode: "auto" },
      "u-1",
    );
    assertEquals(calls("UPDATE registries SET remainder_queue = $2").length, 0);
  });

  it("without a mode — an older client — the split is stored as sent and the line is not touched", async () => {
    stubBook(["u-2", "u-1"]);
    await createTransaction(newTx(split(5.05, 5.06)), "u-1");
    assertEquals(calls("remainder_queue").length, 0);
    assertEquals(json(dealtParams()[0]), split(5.05, 5.06));
  });

  it("Monto Fijo is stored as typed", async () => {
    stubBook(["u-2"]);
    const tx = await createTransaction({ ...newTx(split(6.06, 4.05)), splitMode: "fixed" }, "u-1");
    assertEquals(json(dealtParams()[0]), { ...split(6.06, 4.05), mode: "fixed" });
    assertEquals(calls("UPDATE registries SET remainder_queue = $2").length, 0);
    assertEquals(tx?.remainderQueue, ["u-2"]);
  });

  it("a payment is never dealt", async () => {
    stubBook([]);
    await createTransaction({ ...newTx(split(10.11, 0), "pago"), splitMode: "auto" }, "u-1");
    assertEquals(calls("remainder_queue").length, 0);
    assertEquals(json(dealtParams()[0]), split(10.11, 0));
  });

  it("an edit that leaves the split alone keeps its cents, its turn and its mode", async () => {
    // Saved as a 50/50 percentage split; the form opens it as Auto because the
    // amounts look even, and sends that. The stored mode is the one to keep.
    const saved: TransactionSplit = {
      splits: [
        { userId: "u-1", percentage: 50.05, amount: 5.11 },
        { userId: "u-2", percentage: 49.95, amount: 5.1 },
      ],
      mode: "percentage",
    };
    stubBook(["u-1"], JSON.stringify(saved));
    await updateTransaction(
      "tx-1",
      { description: "Dinner, edited", originalAmount: 10.21, splitJson: saved, splitMode: "auto" },
      "u-1",
    );
    assertEquals(calls("remainder_queue").length, 0);
    assertEquals(
      json(calls("UPDATE transactions")[0]?.params.find((p) => String(p).includes("splits"))),
      saved,
    );
  });

  it("gives a row older than the modes its mode when it is edited", async () => {
    stubBook(["u-1"], JSON.stringify(split(5.06, 5.05)));
    await updateTransaction(
      "tx-1",
      { originalAmount: 10.11, splitJson: split(5.06, 5.05), splitMode: "auto" },
      "u-1",
    );
    assertEquals(
      json(calls("UPDATE transactions")[0]?.params.find((p) => String(p).includes("splits"))),
      { ...split(5.06, 5.05), mode: "auto" },
    );
    assertEquals(calls("remainder_queue").length, 0);
  });

  it("an edit that changes the split is dealt against the line as it stands", async () => {
    stubBook(["u-1", "u-2"], JSON.stringify({ ...split(5.06, 5.05), mode: "auto" }));
    // The amount became $10.21: 5.10 each and a cent, which is u-1's turn.
    const updated = await updateTransaction(
      "tx-1",
      { originalAmount: 10.21, splitJson: split(5.1, 5.11), splitMode: "auto" },
      "u-1",
    );
    assertEquals(
      json(calls("UPDATE transactions")[0]?.params.find((p) => String(p).includes("splits"))),
      { ...split(5.11, 5.1), mode: "auto" },
    );
    assertEquals(calls("UPDATE registries SET remainder_queue = $2")[0]?.params, [
      "reg-1",
      '["u-2","u-1"]',
    ]);
    assertEquals(updated?.remainderQueue, ["u-2", "u-1"]);
  });

  it("the row being edited is locked before the book's line", async () => {
    stubBook(["u-1", "u-2"], JSON.stringify(split(5.06, 5.05)));
    await updateTransaction(
      "tx-1",
      { originalAmount: 10.21, splitJson: split(5.1, 5.11), splitMode: "auto" },
      "u-1",
    );
    const texts = __queryLog.map((c) => c.text);
    const row = texts.findIndex(
      (t) => t.includes("FROM transactions WHERE id = $1") && t.includes("FOR UPDATE"),
    );
    const line = texts.findIndex((t) => t.includes("remainder_queue = remainder_queue"));
    assertEquals(row !== -1 && row < line, true);
  });

  describe("instalments and recurring expenses", () => {
    const INSTALMENT = storedRow({
      type: "parcialidad",
      amount: "10.11",
      original_amount: "10.11",
      installment_current: 1,
      installment_total: 12,
      split_json: { ...split(5.06, 5.05), mode: "auto" },
    });

    /** A book whose line is `line`, with `sources` to carry forward. */
    function stubCarry(line: string[], sources: Record<string, unknown>[]) {
      __setQueryResult((text) => {
        if (text.includes("id = ANY")) return { rows: sources };
        if (text.includes("remainder_queue = remainder_queue")) {
          return { rows: [{ remainder_queue: line }] };
        }
        if (text.includes("INSERT INTO transactions")) return { rows: sources };
        return { rows: [] };
      });
    }

    const cloneParams = () => {
      const insert = calls("INSERT INTO transactions")[0];
      const flat = insert?.params ?? [];
      // 14 columns per row; split_json is the twelfth.
      return Array.from({ length: flat.length / 14 }, (_, i) => json(flat[i * 14 + 11]));
    };
    const instalments = () => {
      const flat = calls("INSERT INTO transactions")[0]?.params ?? [];
      return Array.from({ length: flat.length / 14 }, (_, i) => flat[i * 14 + 6]);
    };

    it("each instalment takes its turn from the book's line when it is created", async () => {
      stubCarry([], [INSTALMENT]);
      await batchCloneTransactions([{ id: "tx-1", quantity: 4 }], "u-1");
      assertEquals(
        cloneParams().map((splitJson) => splitJson.splits.map((s: { amount: number }) => s.amount)),
        [
          [5.06, 5.05],
          [5.05, 5.06],
          [5.06, 5.05],
          [5.05, 5.06],
        ],
      );
      assertEquals(instalments(), [2, 3, 4, 5]);
      assertEquals(calls("UPDATE registries SET remainder_queue = $2")[0]?.params, [
        "reg-1",
        '["u-1","u-2"]',
      ]);
    });

    it("shares that line with every other expense of the book", async () => {
      // u-1 took the last cent; the first instalment therefore goes to u-2.
      stubCarry(["u-1"], [INSTALMENT]);
      await batchCloneTransactions([{ id: "tx-1", quantity: 2 }], "u-1");
      assertEquals(
        cloneParams().map((splitJson) => splitJson.splits[0].amount),
        [5.05, 5.06],
      );
    });

    it("deals an old even split as Auto, since the form reads it that way", async () => {
      stubCarry(
        [],
        [storedRow({ amount: "10.11", original_amount: "10.11", split_json: split(5.06, 5.05) })],
      );
      await batchCloneTransactions([{ id: "tx-1", quantity: 1 }], "u-1");
      assertEquals(cloneParams()[0], { ...split(5.06, 5.05), mode: "auto" });
      // The cent went to u-1 again, as the empty line says, and u-1 took its turn.
      assertEquals(calls("UPDATE registries SET remainder_queue = $2")[0]?.params, [
        "reg-1",
        '["u-1"]',
      ]);
    });

    it("copies Monto Fijo as typed, and leaves the line alone", async () => {
      stubCarry(
        [],
        [
          storedRow({
            amount: "10.11",
            original_amount: "10.11",
            split_json: { ...split(6.06, 4.05), mode: "fixed" },
          }),
        ],
      );
      await batchCloneTransactions([{ id: "tx-1", quantity: 1 }], "u-1");
      assertEquals(cloneParams(), [{ ...split(6.06, 4.05), mode: "fixed" }]);
      assertEquals(calls("UPDATE registries SET remainder_queue = $2").length, 0);
    });

    it("copies an old split that is neither even nor marked, as it stands", async () => {
      // Before modes were recorded there is no telling a custom Porcentaje
      // split from Monto Fijo, so neither is second-guessed.
      stubCarry(
        [],
        [
          storedRow({
            amount: "10.11",
            original_amount: "10.11",
            split_json: split(6.06, 4.05),
          }),
        ],
      );
      await batchCloneTransactions([{ id: "tx-1", quantity: 1 }], "u-1");
      assertEquals(cloneParams(), [split(6.06, 4.05)]);
      assertEquals(calls("remainder_queue").length, 0);
    });

    it("deals a Porcentaje instalment by its percentages, ties and all", async () => {
      // 50/50 of $10.11 is a tie, so the line decides and the instalments alternate.
      const fifty = storedRow({
        type: "parcialidad",
        amount: "10.11",
        original_amount: "10.11",
        installment_current: 1,
        installment_total: 12,
        split_json: {
          splits: [
            { userId: "u-1", percentage: 50, amount: 5.06 },
            { userId: "u-2", percentage: 50, amount: 5.05 },
          ],
          mode: "percentage",
        },
      });
      stubCarry(["u-1"], [fifty]);
      await batchCloneTransactions([{ id: "tx-1", quantity: 3 }], "u-1");
      assertEquals(
        cloneParams().map((splitJson) => splitJson.splits.map((s: { amount: number }) => s.amount)),
        [
          [5.05, 5.06],
          [5.06, 5.05],
          [5.05, 5.06],
        ],
      );
      assertEquals(instalments(), [2, 3, 4]);
      assertEquals(cloneParams()[0].mode, "percentage");
    });

    it("keeps each instalment's own number when several are carried at once", async () => {
      stubCarry(
        [],
        [
          INSTALMENT,
          storedRow({
            id: "tx-2",
            installment_current: 7,
            type: "parcialidad",
            installment_total: 12,
          }),
        ],
      );
      await batchCloneTransactions(
        [
          { id: "tx-1", quantity: 2 },
          { id: "tx-2", quantity: 3 },
        ],
        "u-1",
      );
      assertEquals(instalments(), [2, 3, 8, 9, 10]);
    });
  });
});
