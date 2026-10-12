/**
 * Tests for the shared transaction-form parser. These rules are the balance
 * integrity boundary: whatever passes here gets persisted and summed into
 * balances verbatim.
 */
import { assertEquals } from "@test/compat";
import { describe, it } from "@test/compat";
import { parseTransactionForm } from "./transaction-validation";

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    description: "Dinner",
    amount: "100",
    originalAmount: "100",
    type: "unico",
    userPaid: "u1",
    registryId: "r1",
    splitJson: JSON.stringify({
      splits: [
        { userId: "u1", percentage: 50, amount: 50 },
        { userId: "u2", percentage: 50, amount: 50 },
      ],
    }),
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.append(k, v);
  }
  return fd;
}

describe("parseTransactionForm — accepted", () => {
  it("parses a valid expense form", () => {
    const result = parseTransactionForm(form());
    assertEquals(result.ok, true);
  });

  it("accepts a split within rounding tolerance of the total", () => {
    const result = parseTransactionForm(
      form({
        splitJson: JSON.stringify({
          splits: [
            { userId: "u1", percentage: 33.33, amount: 33.33 },
            { userId: "u2", percentage: 33.33, amount: 33.33 },
            { userId: "u3", percentage: 33.34, amount: 33.34 },
          ],
        }),
      }),
    );
    assertEquals(result.ok, true);
  });

  it("accepts pagos whose single split is the recipient", () => {
    const result = parseTransactionForm(
      form({
        type: "pago",
        splitJson: JSON.stringify({
          splits: [{ userId: "u2", percentage: 100, amount: 100 }],
        }),
      }),
    );
    assertEquals(result.ok, true);
  });

  it("accepts linked payments that sum to at most the pago amount", () => {
    const result = parseTransactionForm(
      form({
        type: "pago",
        transactionPayments: JSON.stringify([
          { expenseId: "tx-1", amount: 60 },
          { expenseId: "tx-2", amount: 40 },
        ]),
        splitJson: JSON.stringify({
          splits: [{ userId: "u2", percentage: 100, amount: 100 }],
        }),
      }),
    );
    assertEquals(result.ok, true);
  });

  it("accepts an empty transactionPayments array (clearing links on edit)", () => {
    const result = parseTransactionForm(
      form({
        type: "pago",
        transactionPayments: "[]",
        splitJson: JSON.stringify({
          splits: [{ userId: "u2", percentage: 100, amount: 100 }],
        }),
      }),
    );
    assertEquals(result.ok, true);
  });
});

describe("parseTransactionForm — rejected", () => {
  it("rejects splits that don't sum to the expense total", () => {
    const result = parseTransactionForm(
      form({
        splitJson: JSON.stringify({
          splits: [
            { userId: "u1", percentage: 50, amount: 50 },
            { userId: "u2", percentage: 50, amount: 20 },
          ],
        }),
      }),
    );
    assertEquals(result.ok, false);
  });

  it("rejects negative split amounts", () => {
    const result = parseTransactionForm(
      form({
        splitJson: JSON.stringify({
          splits: [
            { userId: "u1", percentage: 120, amount: 120 },
            { userId: "u2", percentage: -20, amount: -20 },
          ],
        }),
      }),
    );
    assertEquals(result.ok, false);
  });

  it("rejects a non-numeric split amount", () => {
    const result = parseTransactionForm(
      form({
        splitJson: JSON.stringify({
          splits: [{ userId: "u1", percentage: 100, amount: "100" }],
        }),
      }),
    );
    assertEquals(result.ok, false);
  });

  it("rejects an unknown transaction type", () => {
    const result = parseTransactionForm(form({ type: "heist" }));
    assertEquals(result.ok, false);
  });

  it("rejects a zero or negative amount", () => {
    assertEquals(parseTransactionForm(form({ amount: "0" })).ok, false);
    assertEquals(parseTransactionForm(form({ amount: "-5" })).ok, false);
  });

  it("rejects an absurdly large amount", () => {
    const result = parseTransactionForm(form({ amount: "1e12" }));
    assertEquals(result.ok, false);
  });

  it("rejects linked payments exceeding the pago amount", () => {
    const result = parseTransactionForm(
      form({
        type: "pago",
        transactionPayments: JSON.stringify([
          { expenseId: "tx-1", amount: 90 },
          { expenseId: "tx-2", amount: 90 },
        ]),
        splitJson: JSON.stringify({
          splits: [{ userId: "u2", percentage: 100, amount: 100 }],
        }),
      }),
    );
    assertEquals(result.ok, false);
  });

  it("rejects a linked payment entry with a non-numeric amount", () => {
    const result = parseTransactionForm(
      form({
        type: "pago",
        transactionPayments: JSON.stringify([{ expenseId: "tx-1" }]),
        splitJson: JSON.stringify({
          splits: [{ userId: "u2", percentage: 100, amount: 100 }],
        }),
      }),
    );
    assertEquals(result.ok, false);
  });

  it("rejects installments out of range", () => {
    assertEquals(
      parseTransactionForm(form({ type: "parcialidad", installmentTotal: "0" })).ok,
      false,
    );
    assertEquals(
      parseTransactionForm(
        form({
          type: "parcialidad",
          installmentTotal: "6",
          installmentCurrent: "9",
        }),
      ).ok,
      false,
    );
  });
});
