import type { APIRoute } from "astro";
import { useInvitation as acceptInvitation } from "@/lib/store";
import { t } from "@/lib/i18n";
import { GroupFullError } from "@/lib/entitlements";

export const POST: APIRoute = async (ctx) => {
  const body = await ctx.request.json();
  const code = body.code as string;
  const systemUserId = ctx.locals.user?.id;

  if (!code || !systemUserId) {
    return Response.json({ error: "Missing data" }, { status: 400 });
  }

  try {
    const registryId = await acceptInvitation(code, systemUserId);
    return Response.json({ registryId });
  } catch (err) {
    // Map the member-cap error to a 402 upgrade signal with a friendly
    // localized message; every other failure stays a plain 400.
    // instanceof (vs message matching) keeps the contract drift-proof.
    if (err instanceof GroupFullError) {
      return Response.json(
        {
          code: "upgrade_required",
          reason: "members",
          error: t(ctx.locals.locale, "billing.group_full"),
        },
        { status: 402 },
      );
    }
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 400 },
    );
  }
};
