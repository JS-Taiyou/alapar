import type { APIRoute } from "astro";
import {
  batchCloneTransactions,
  getTransactionsByIds,
} from "@/lib/store";

// Caps against batch-clone DoS (unbounded quantity × items previously let a
// single request insert thousands of rows).
const MAX_ITEMS = 100;
const MAX_QUANTITY = 60;

export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await ctx.request.json();
  const items: { id: string; quantity?: number }[] = body.items ?? [];
  if (!Array.isArray(items)) {
    return Response.json({ error: "Invalid items" }, { status: 400 });
  }
  if (items.length === 0) {
    return Response.json({ created: 0 });
  }
  if (items.length > MAX_ITEMS) {
    return Response.json({ error: "Too many items" }, { status: 400 });
  }

  for (const item of items) {
    const quantity = item?.quantity ?? 1;
    if (
      typeof item?.id !== "string" || !Number.isInteger(quantity) ||
      quantity < 1 || quantity > MAX_QUANTITY
    ) {
      return Response.json({ error: "Invalid item" }, { status: 400 });
    }
  }

  // Resolve EVERY source first: all must exist, and every source's
  // registry — not just the first item's — must belong to the caller.
  const requestedIds = new Set(items.map((i) => i.id));
  const sources = await getTransactionsByIds([...requestedIds]);
  if (sources.length !== requestedIds.size) {
    return new Response("Not found", { status: 404 });
  }
  const memberRegistryIds = new Set(ctx.locals.registries.map((r) => r.id));
  const allInMemberRegistries = sources.every((tx) =>
    memberRegistryIds.has(tx.registry_id)
  );
  if (!allInMemberRegistries) {
    return new Response("Forbidden", { status: 403 });
  }

  // quantity only means something for parcialidad (how many installments to
  // carry). A quantity > 1 on anything else used to be silently discarded
  // by the cloner — reject it so the contract can't be misread.
  const sourceById = new Map(sources.map((tx) => [tx.id, tx]));
  for (const item of items) {
    const source = sourceById.get(item.id);
    if (source && source.type !== "parcialidad" && (item.quantity ?? 1) > 1) {
      return Response.json(
        { error: "quantity > 1 only applies to parcialidad items" },
        { status: 400 },
      );
    }
  }

  const cloned = await batchCloneTransactions(
    items.map((item) => ({ id: item.id, quantity: item.quantity ?? 1 })),
    userId,
  );

  return Response.json({ created: cloned.length });
};
