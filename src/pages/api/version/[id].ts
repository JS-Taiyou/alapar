import type { APIRoute } from "astro";
import { getRegistryStamp, isMemberOfRegistry } from "@/lib/store";
import { getRegistryVersion, versionNamespaceRegistered } from "@/lib/registry-version";

/**
 * GET /api/version/<registryId> — the polling sync's cheap outer gate
 * (retired Supabase Realtime). Serves the registry's version from the KV
 * mirror: no Postgres, no Supabase, ~ms at the edge. Falls back to reading
 * the authoritative `last_modified` from Postgres when the mirror has no
 * entry yet (registry never mutated since deployment) or KV isn't bound
 * (local dev). Side-effect free — unlike POST /api/stamp, this never marks
 * the registry active.
 */
export const POST: APIRoute = () => {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

export const GET: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  const registryId = ctx.params.id;

  if (!userId || !registryId) {
    return Response.json({ error: "Missing data" }, { status: 400 });
  }

  const member = await isMemberOfRegistry(userId, registryId);
  if (!member) {
    return Response.json({ error: "Not a member" }, { status: 403 });
  }

  let version: string | null = null;
  if (versionNamespaceRegistered()) {
    version = await getRegistryVersion(registryId);
  }
  if (version === null) {
    version = await getRegistryStamp(registryId);
  }

  return Response.json({ version });
};
