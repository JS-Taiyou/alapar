import type { APIRoute } from "astro";
import { query } from "@/lib/db";

export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await ctx.request.json();
  const { endpoint } = body as { endpoint: string };

  if (!endpoint) {
    return Response.json({ error: "Missing endpoint" }, { status: 400 });
  }

  await query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [
    endpoint,
    userId,
  ]);

  return Response.json({ ok: true });
};
