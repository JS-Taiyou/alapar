import { assert, assertEquals, describe, it } from "@test/compat";
import { calculateBalance } from "../../lib/calculations";
import { buildDemoData } from "./demo-data";

/**
 * data/demo.json is hand-written, and a typo there surfaces on the public
 * demo as a wrong balance or a payer nobody has heard of. These checks keep
 * the seed internally consistent.
 */
describe("demo seed data", () => {
  const { user, books } = buildDemoData();
  const cents = (n: number) => Math.round(n * 100);

  it("has three books and gives every person and book a unique id", () => {
    assertEquals(books.length, 3);
    const registryIds = books.map((b) => b.registry.id);
    assertEquals(new Set(registryIds).size, registryIds.length);

    // The same person may sit in several books — but only once per book.
    for (const b of books) {
      const memberIds = b.users.map((u) => u.id);
      assertEquals(
        new Set(memberIds).size,
        memberIds.length,
        `${b.registry.name}: member listed twice`,
      );
    }
  });

  it("puts the demo user in every book, with an owner among the members", () => {
    for (const b of books) {
      assert(
        b.snapshot.users.some((u) => u.id === user.id),
        `${b.registry.name}: the demo user is not a member`,
      );
      assert(
        b.users.some((u) => u.id === b.ownerId),
        `${b.registry.name}: the owner is not a member`,
      );
      assert(b.users.length >= 2, `${b.registry.name}: nothing to split`);
    }
  });

  it("only lets members of a book pay and share its transactions", () => {
    for (const b of books) {
      const members = new Set(b.users.map((u) => u.id));
      const { transactions } = b.snapshot;
      assertEquals(new Set(transactions.map((t) => t.id)).size, transactions.length);

      for (const t of transactions) {
        assertEquals(t.registry_id, b.registry.id);
        assert(members.has(t.userPaid), `${t.id}: the payer is not a member`);
        assertEquals(t.paidByUser?.id, t.userPaid);
        for (const s of t.splitJson.splits) {
          assert(members.has(s.userId), `${t.id}: a split share goes to a non-member`);
        }
      }
    }
  });

  it("splits every expense into shares that add up to its total", () => {
    for (const b of books) {
      for (const t of b.snapshot.transactions) {
        if (t.type === "pago" || t.type === "ajuste") {
          assertEquals(t.splitJson.splits.length, 1, `${t.id}: a payment has one recipient`);
          continue;
        }
        const shares = t.splitJson.splits.reduce((sum, s) => sum + s.amount, 0);
        assertEquals(cents(shares), cents(t.originalAmount), `${t.id}: shares don't add up`);
      }
    }
  });

  it("keeps installments inside their own range", () => {
    for (const b of books) {
      for (const t of b.snapshot.transactions) {
        if (t.type !== "parcialidad") continue;
        const { installmentCurrent: current, installmentTotal: total } = t;
        assert(
          current !== null && total !== null && current >= 1 && current <= total,
          `${t.id}: ${current} of ${total}`,
        );
      }
    }
  });

  it("links payments to expenses of the same book, never beyond the payment", () => {
    for (const b of books) {
      const byId = new Map(b.snapshot.transactions.map((t) => [t.id, t]));
      for (const tp of b.snapshot.transactionPayments) {
        const pago = byId.get(tp.pagoId);
        const expense = byId.get(tp.expenseId);
        assert(pago?.type === "pago", `${tp.id}: the link must start at a payment`);
        assert(
          expense && expense.type !== "pago" && expense.type !== "ajuste",
          `${tp.id}: the link must point at an expense`,
        );
        assert(
          tp.amount > 0 && tp.amount <= pago.originalAmount,
          `${tp.id}: the link exceeds the payment`,
        );
      }
    }
  });

  it("keeps every book settled as a whole (members' balances sum to zero)", () => {
    for (const b of books) {
      const total = b.snapshot.users.reduce(
        (sum, u) => sum + calculateBalance(b.snapshot.transactions, u.id),
        0,
      );
      assertEquals(cents(total), 0, b.registry.name);
    }
  });

  it("shows a header balance that matches the per-person breakdown", () => {
    for (const b of books) {
      const breakdown = b.snapshot.balanceEntries.reduce((sum, e) => sum + e.amount, 0);
      assertEquals(cents(breakdown), cents(b.snapshot.balance), b.registry.name);
    }
  });
});
