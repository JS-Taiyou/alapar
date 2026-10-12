import type { APIRoute } from "astro";
import { query } from "@/lib/db";
import { isMemberOfRegistry } from "@/lib/store";

export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await ctx.request.json();
  const { endpoint, keys, registryId } = body as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    registryId?: string;
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: "Missing subscription data" }, {
      status: 400,
    });
  }

  // Only accept genuine push-service endpoints (https), not arbitrary URLs.
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return Response.json({ error: "Invalid endpoint" }, { status: 400 });
  }
  if (endpointUrl.protocol !== "https:") {
    return Response.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  // The client-supplied registryId must be one the user actually belongs
  // to. (This is a lightweight path, so ctx.locals.registries isn't
  // populated — check membership directly.)
  if (registryId != null) {
    const member = await isMemberOfRegistry(userId, registryId);
    if (!member) {
      return Response.json({ error: "No eres miembro" }, { status: 403 });
    }
  }

  // ON CONFLICT: also re-assign user_id/registry_id so a re-subscribed
  // endpoint can't keep delivering to a previous owner's registry.
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, registry_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id, registry_id = EXCLUDED.registry_id, updated_at = NOW()`,
    [userId, endpoint, keys.p256dh, keys.auth, registryId ?? null],
  );

  return Response.json({ ok: true });
};
