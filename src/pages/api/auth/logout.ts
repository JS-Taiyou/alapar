import type { APIRoute } from "astro";
import { clearAuthCookies, createServerClient } from "@/lib/supabase";
import { getCookie } from "@/lib/auth-cookies";

export const POST: APIRoute = async (ctx) => {
  const headers = new Headers();

  // Best-effort server-side revocation: admin.signOut invalidates every
  // session (incl. refresh tokens) for the user owning this access JWT.
  // Cookie clearing below happens regardless of the outcome.
  const accessToken = getCookie(ctx.request.headers.get("cookie") ?? "", "sb-access-token");
  if (accessToken) {
    try {
      await createServerClient().auth.admin.signOut(accessToken);
    } catch {
      // Revocation is best-effort; still clear local cookies.
    }
  }

  clearAuthCookies(headers);

  const accept = ctx.request.headers.get("Accept") ?? "";
  if (accept.includes("application/json")) {
    return Response.json({ ok: true }, { status: 200, headers });
  }

  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
};
