import type { APIRoute } from "astro";
import { getTransactionById, updateTransaction } from "@/lib/store";

export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await ctx.request.json();
  const id: string = body.id;
  if (!id) return new Response("Missing id", { status: 400 });

  const tx = await getTransactionById(id);
  if (!tx) return new Response("Not found", { status: 404 });

  const updated = await updateTransaction(
    id,
    { recurringDisabled: true },
    userId,
  );
  if (!updated) return new Response("Forbidden", { status: 403 });

  return Response.json({ ok: true });
};
