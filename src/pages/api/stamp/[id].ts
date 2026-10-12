import type { APIRoute } from "astro";
import { getRegistryStamp, isMemberOfRegistry } from "@/lib/store";
import { setUserActiveRegistry } from "@/lib/server-cache";

// Switching the active registry is a side effect — POST only, never GET.
export const GET: APIRoute = () => {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  const registryId = ctx.params.id;

  if (!userId || !registryId) {
    return Response.json({ error: "Missing data" }, { status: 400 });
  }

  const member = await isMemberOfRegistry(userId, registryId);
  if (!member) {
    return Response.json({ error: "Not a member" }, { status: 403 });
  }

  setUserActiveRegistry(userId, registryId);

  const lastModified = await getRegistryStamp(registryId);

  return Response.json({ lastModified });
};
