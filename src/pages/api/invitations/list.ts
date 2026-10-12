import type { APIRoute } from "astro";
import { getInvitationsForRegistry, getUserRole } from "@/lib/store";

export const GET: APIRoute = async (ctx) => {
  const registryId = ctx.url.searchParams.get("registryId");
  const systemUserId = ctx.locals.user?.id;

  if (!registryId || !systemUserId) {
    return Response.json({ error: "Missing data" }, { status: 400 });
  }

  const role = await getUserRole(systemUserId, registryId);
  if (role !== "owner") {
    return Response.json(
      { error: "Only owners can list invitations" },
      {
        status: 403,
      },
    );
  }

  const invitations = await getInvitationsForRegistry(registryId);

  return Response.json(invitations);
};
