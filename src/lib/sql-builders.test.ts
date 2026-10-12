import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import { buildBatchPlaceholders, buildTransactionUpdateSets } from "./sql-builders";

// ===========================================================================
// buildBatchPlaceholders
// ===========================================================================

describe("buildBatchPlaceholders", () => {
  it("builds a single row of 3 columns", () => {
    assertEquals(buildBatchPlaceholders(1, 3), "($1, $2, $3)");
  });

  it("builds two rows of 3 columns with correct numbering", () => {
    assertEquals(buildBatchPlaceholders(2, 3), "($1, $2, $3), ($4, $5, $6)");
  });

  it("builds the 14-column case used by batchCloneTransactions", () => {
    // 2 sources × 14 columns — spot-check the seam between rows.
    const result = buildBatchPlaceholders(2, 14);
    assertEquals(result.startsWith("($1, $2"), true);
    assertEquals(result.includes("$14"), true);
    assertEquals(result.includes("$15"), true); // second row starts
    assertEquals(result.includes("$28"), true); // last placeholder
    assertEquals(result.endsWith("$28)"), true);
  });

  it("returns an empty string for zero rows", () => {
    assertEquals(buildBatchPlaceholders(0, 3), "");
  });

  it("handles a single column (degenerate case)", () => {
    assertEquals(buildBatchPlaceholders(3, 1), "($1), ($2), ($3)");
  });

  it("produces correct placeholder count for N rows × M cols", () => {
    for (const [rows, cols] of [
      [3, 5],
      [1, 1],
      [10, 2],
      [4, 14],
    ]) {
      const result = buildBatchPlaceholders(rows, cols);
      const placeholderCount = (result.match(/\$\d+/g) ?? []).length;
      assertEquals(placeholderCount, rows * cols);
    }
  });
});

// ===========================================================================
// buildTransactionUpdateSets
// ===========================================================================

describe("buildTransactionUpdateSets", () => {
  it("returns empty sets/values when data has no settable fields", () => {
    const { sets, values } = buildTransactionUpdateSets({});
    assertEquals(sets, []);
    assertEquals(values, []);
  });

  it("returns empty when data only has fields not in the allowlist (e.g. id)", () => {
    const { sets, values } = buildTransactionUpdateSets({
      id: "tx-1",
      createdAt: new Date(),
    } as never);
    assertEquals(sets, []);
    assertEquals(values, []);
  });

  it("builds a single-field SET with 1-indexed placeholder", () => {
    const { sets, values } = buildTransactionUpdateSets({ description: "X" });
    assertEquals(sets, ["description = $1"]);
    assertEquals(values, ["X"]);
  });

  it("numbers placeholders sequentially across multiple fields", () => {
    const { sets, values } = buildTransactionUpdateSets({
      description: "X",
      amount: 100,
      notes: "n",
    });
    assertEquals(sets, ["description = $1", "amount = $2", "notes = $3"]);
    assertEquals(values, ["X", 100, "n"]);
  });

  it("serializes splitJson to a JSON string", () => {
    const { sets, values } = buildTransactionUpdateSets({
      splitJson: { splits: [{ userId: "u1", percentage: 100, amount: 50 }] },
    });
    assertEquals(sets, ["split_json = $1"]);
    assertEquals(values, [
      JSON.stringify({
        splits: [{ userId: "u1", percentage: 100, amount: 50 }],
      }),
    ]);
  });

  it("includes all 11 settable fields with correct snake_case column names", () => {
    const { sets } = buildTransactionUpdateSets({
      description: "d",
      amount: 1,
      originalAmount: 2,
      type: "unico",
      notes: "n",
      splitJson: { splits: [] },
      userPaid: "u1",
      installmentCurrent: 1,
      installmentTotal: 12,
      recurringDisabled: true,
      relatedTransactionId: "tx-2",
    });
    assertEquals(sets.length, 11);
    assertEquals(sets, [
      "description = $1",
      "amount = $2",
      "original_amount = $3",
      "type = $4",
      "notes = $5",
      "split_json = $6",
      "user_paid = $7",
      "installment_current = $8",
      "installment_total = $9",
      "recurring_disabled = $10",
      "related_transaction_id = $11",
    ]);
  });

  it("treats explicitly-undefined fields as absent (not set to null)", () => {
    // This is the load-bearing behavior: only `!== undefined` fields update.
    const { sets, values } = buildTransactionUpdateSets({
      description: "X",
      amount: undefined,
    });
    assertEquals(sets, ["description = $1"]);
    assertEquals(values, ["X"]);
  });

  it("allows setting a field to null explicitly (e.g. relatedTransactionId)", () => {
    const { sets, values } = buildTransactionUpdateSets({
      relatedTransactionId: null,
    });
    assertEquals(sets, ["related_transaction_id = $1"]);
    assertEquals(values, [null]);
  });
});
