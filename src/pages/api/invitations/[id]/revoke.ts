import type { APIRoute } from "astro";
import { revokeInvitation } from "@/lib/store";

export const POST: APIRoute = async (ctx) => {
  const invitationId = ctx.params.id;
  const systemUserId = ctx.locals.user?.id;

  if (!invitationId || !systemUserId) {
    return Response.json({ error: "Missing data" }, { status: 400 });
  }

  // The revoke is ownership-scoped in SQL: it only lands when the user owns
  // the registry the invitation belongs to (regardless of which registry is
  // active). A foreign or unknown id therefore no-ops → 404.
  const revoked = await revokeInvitation(invitationId, systemUserId);
  if (!revoked) {
    return Response.json(
      { error: "Not found or forbidden" },
      {
        status: 404,
      },
    );
  }

  return Response.json({ ok: true });
};
