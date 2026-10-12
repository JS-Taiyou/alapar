import type { APIRoute } from "astro";
import { createServerClient, setAuthCookies } from "@/lib/supabase";

export const POST: APIRoute = async (ctx) => {
  // JSON only: keeps this endpoint out of simple HTML-form CSRF territory
  // (the csrf middleware already enforces a matching Origin).
  const contentType = ctx.request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return Response.json({ error: "Expected application/json" }, {
      status: 400,
    });
  }

  let body: { accessToken?: unknown; refreshToken?: unknown };
  try {
    body = await ctx.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const accessToken = body.accessToken as string;
  const refreshToken = body.refreshToken as string;

  if (!accessToken || !refreshToken) {
    return Response.json({ error: "Missing tokens" }, { status: 400 });
  }

  // Validate the token pair with Supabase before setting auth cookies:
  // an arbitrary/garbage token must never become a session.
  const client = createServerClient();
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return Response.json({ error: "Invalid tokens" }, { status: 401 });
  }

  const headers = new Headers();
  setAuthCookies(headers, accessToken, refreshToken);

  return Response.json({ ok: true }, { headers });
};
