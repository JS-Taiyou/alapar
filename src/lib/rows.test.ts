import { assertEquals, assertInstanceOf } from "@test/compat";
import { describe, it } from "@test/compat";
import {
  rowToEnrichedTransaction,
  rowToEntity,
  rowToExercise,
  rowToRegistry,
  rowToTransaction,
  rowToTransactionPayment,
  rowToUser,
} from "./rows";

// ---------------------------------------------------------------------------
// rowToUser
// ---------------------------------------------------------------------------

describe("rowToUser", () => {
  it("maps snake_case columns to the User shape", () => {
    const user = rowToUser({
      id: "u-1",
      name: "Alice",
      color: "#ff0000",
      email: "alice@example.com",
      supabase_auth_id: "auth-uuid-1",
      created_at: "2024-01-15T10:00:00Z",
    });
    assertEquals(user, {
      id: "u-1",
      name: "Alice",
      color: "#ff0000",
      email: "alice@example.com",
      supabaseAuthId: "auth-uuid-1",
      createdAt: new Date("2024-01-15T10:00:00Z"),
      // No `pro` column in the row → maps to null (not Pro).
      pro: null,
    });
  });

  it("maps the computed pro column when present", () => {
    assertEquals(
      rowToUser({
        id: "u-2",
        name: "Bob",
        color: "#00ff00",
        email: "bob@example.com",
        supabase_auth_id: null,
        created_at: "2024-01-15T10:00:00Z",
        pro: "grandfathered",
      }).pro,
      "grandfathered",
    );
  });

  it("coerces a null supabase_auth_id to null (not undefined)", () => {
    const user = rowToUser({
      id: "u-2",
      name: "Bob",
      color: "#00ff00",
      email: "bob@example.com",
      supabase_auth_id: null,
      created_at: "2024-01-15T10:00:00Z",
    });
    assertEquals(user.supabaseAuthId, null);
  });

  it("wraps created_at in a Date instance", () => {
    const user = rowToUser({
      id: "u-3",
      name: "Carol",
      color: "#0000ff",
      email: "carol@example.com",
      supabase_auth_id: "x",
      created_at: "2024-06-01T12:30:00Z",
    });
    assertInstanceOf(user.createdAt, Date);
  });
});

// ---------------------------------------------------------------------------
// rowToTransaction
// ---------------------------------------------------------------------------

describe("rowToTransaction", () => {
  const baseRow = {
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
    split_json: '{"splits":[{"userId":"u1","percentage":100,"amount":100.50}]}',
    related_transaction_id: null,
    creator_id: "u-1",
    user_paid: "u-1",
    created_at: "2024-01-15T10:00:00Z",
  };

  it("parses numeric columns via parseFloat", () => {
    const tx = rowToTransaction(baseRow);
    assertEquals(tx.amount, 100.5);
    assertEquals(tx.originalAmount, 100.5);
  });

  it("parses amount/originalAmount when they arrive as numbers (Supabase Realtime shape)", () => {
    // Realtime postgres_changes payloads deliver numerics as JSON numbers.
    const tx = rowToTransaction({
      ...baseRow,
      amount: 100.5,
      original_amount: 100.5,
    });
    assertEquals(tx.amount, 100.5);
    assertEquals(tx.originalAmount, 100.5);
  });

  it("parses amount/originalAmount when they arrive as strings (pg shape)", () => {
    const tx = rowToTransaction({
      ...baseRow,
      amount: "42.99",
      original_amount: "42.99",
    });
    assertEquals(tx.amount, 42.99);
    assertEquals(tx.originalAmount, 42.99);
  });

  it("parses split_json when it arrives as a string", () => {
    const tx = rowToTransaction(baseRow);
    assertEquals(tx.splitJson, {
      splits: [{ userId: "u1", percentage: 100, amount: 100.5 }],
    });
  });

  it("uses split_json as-is when it arrives as an object", () => {
    const tx = rowToTransaction({
      ...baseRow,
      split_json: { splits: [{ userId: "u2", percentage: 50, amount: 50 }] },
    });
    assertEquals(tx.splitJson, {
      splits: [{ userId: "u2", percentage: 50, amount: 50 }],
    });
  });

  it("falls back to the tx id when recurring_group_id is null", () => {
    const tx = rowToTransaction({ ...baseRow, recurring_group_id: null });
    assertEquals(tx.recurringGroupId, "tx-1");
  });

  it("defaults recurring_disabled to false when null/undefined", () => {
    assertEquals(
      rowToTransaction({ ...baseRow, recurring_disabled: null }).recurringDisabled,
      false,
    );
    assertEquals(
      rowToTransaction({ ...baseRow, recurring_disabled: undefined }).recurringDisabled,
      false,
    );
  });

  it("preserves an explicit true for recurring_disabled", () => {
    assertEquals(
      rowToTransaction({ ...baseRow, recurring_disabled: true }).recurringDisabled,
      true,
    );
  });

  it("defaults related_transaction_id to null when missing", () => {
    const tx = rowToTransaction({
      ...baseRow,
      related_transaction_id: undefined,
    });
    assertEquals(tx.relatedTransactionId, null);
  });
});

// ---------------------------------------------------------------------------
// rowToTransactionPayment
// ---------------------------------------------------------------------------

describe("rowToTransactionPayment", () => {
  it("maps columns and parses amount", () => {
    assertEquals(
      rowToTransactionPayment({
        id: "tp-1",
        pago_id: "pago-1",
        expense_id: "exp-1",
        amount: "25.00",
        created_at: "2024-01-15T10:00:00Z",
      }),
      {
        id: "tp-1",
        pagoId: "pago-1",
        expenseId: "exp-1",
        amount: 25,
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
    );
  });
});

// ---------------------------------------------------------------------------
// rowToExercise
// ---------------------------------------------------------------------------

describe("rowToExercise", () => {
  it("maps columns and parses total_amount", () => {
    const ex = rowToExercise({
      id: "ex-1",
      registry_id: "reg-1",
      start_date: "2024-01-01T00:00:00Z",
      end_date: "2024-02-01T00:00:00Z",
      transaction_count: 12,
      total_amount: "1234.56",
    });
    assertEquals(ex.totalAmount, 1234.56);
    assertEquals(ex.transactionCount, 12);
    assertInstanceOf(ex.startDate, Date);
  });
});

// ---------------------------------------------------------------------------
// rowToRegistry
// ---------------------------------------------------------------------------

describe("rowToRegistry", () => {
  const baseRegRow = {
    id: "reg-1",
    name: "Viaje Playa",
    is_default: false,
    latest_accessed: "2024-01-15T10:00:00Z",
    default_split_json: null,
    default_split_member_count: null,
    last_modified: "2024-06-01T00:00:00Z",
  };

  it("returns null defaultSplit when default_split_json is falsy", () => {
    const reg = rowToRegistry(baseRegRow);
    assertEquals(reg.defaultSplit, null);
    assertEquals(reg.defaultSplitMemberCount, null);
  });

  it("parses default_split_json when it arrives as a string", () => {
    const reg = rowToRegistry({
      ...baseRegRow,
      default_split_json: '{"splits":[{"userId":"u1","percentage":100}]}',
      default_split_member_count: 1,
    });
    assertEquals(reg.defaultSplit, {
      splits: [{ userId: "u1", percentage: 100 }],
    });
    assertEquals(reg.defaultSplitMemberCount, 1);
  });

  it("uses default_split_json as-is when it arrives as an object", () => {
    const reg = rowToRegistry({
      ...baseRegRow,
      default_split_json: { splits: [{ userId: "u2", percentage: 50 }] },
      default_split_member_count: 2,
    });
    assertEquals(reg.defaultSplit, {
      splits: [{ userId: "u2", percentage: 50 }],
    });
  });

  it("returns null lastModified when the column is absent", () => {
    const reg = rowToRegistry({ ...baseRegRow, last_modified: null });
    assertEquals(reg.lastModified, null);
  });

  it("wraps last_modified in a Date when present", () => {
    const reg = rowToRegistry(baseRegRow);
    assertInstanceOf(reg.lastModified, Date);
  });
});

// ---------------------------------------------------------------------------
// rowToEntity
// ---------------------------------------------------------------------------

describe("rowToEntity", () => {
  it("maps id/name/color", () => {
    assertEquals(rowToEntity({ id: "e-1", name: "Landlord", color: "#999" }), {
      id: "e-1",
      name: "Landlord",
      color: "#999",
    });
  });
});

// ---------------------------------------------------------------------------
// rowToEnrichedTransaction
// ---------------------------------------------------------------------------

describe("rowToEnrichedTransaction", () => {
  const rawRow = {
    id: "tx-1",
    registry_id: "reg-1",
    description: "Dinner",
    amount: "100",
    original_amount: "100",
    type: "unico",
    exercise_id: null,
    installment_current: null,
    installment_total: null,
    recurring_disabled: false,
    recurring_group_id: "grp-1",
    notes: "",
    split_json: '{"splits":[]}',
    related_transaction_id: null,
    creator_id: "u-1",
    user_paid: "u-2",
    created_at: "2024-01-15T10:00:00Z",
  };

  it("maps the row and resolves paidByUser from the participant map", () => {
    const bob = { id: "u-2", name: "Bob", color: "#f00" };
    const participantMap = new Map([["u-2", bob]]);
    const result = rowToEnrichedTransaction(rawRow, participantMap);
    assertEquals(result.id, "tx-1");
    assertEquals(result.amount, 100);
    assertEquals(result.paidByUser, bob);
  });

  it("returns null paidByUser when the payer is not in the participant map", () => {
    const result = rowToEnrichedTransaction(rawRow, new Map());
    assertEquals(result.paidByUser, null);
    // the rest of the transaction is still mapped
    assertEquals(result.userPaid, "u-2");
  });

  it("works with Realtime-shaped numeric amounts", () => {
    const result = rowToEnrichedTransaction(
      { ...rawRow, amount: 50.5, original_amount: 50.5 },
      new Map(),
    );
    assertEquals(result.amount, 50.5);
    assertEquals(result.originalAmount, 50.5);
  });
});
