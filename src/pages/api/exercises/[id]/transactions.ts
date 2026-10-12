import type { APIRoute } from "astro";
import { getExerciseByIdForUser, getTransactionsByExerciseForUser } from "@/lib/store";

export const GET: APIRoute = async (ctx) => {
  const exerciseId = ctx.params.id;
  if (!exerciseId) {
    return Response.json({ error: "Missing exercise id" }, { status: 400 });
  }

  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Membership-scoped lookups: an exercise outside the user's registries
  // resolves to 404 (no existence leak), and the transaction query is
  // scoped the same way in SQL as defense in depth.
  const exercise = await getExerciseByIdForUser(exerciseId, userId);
  if (!exercise) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const transactions = await getTransactionsByExerciseForUser(exerciseId, userId);
  return Response.json({ transactions });
};
