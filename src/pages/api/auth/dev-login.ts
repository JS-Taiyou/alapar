import type { APIRoute } from "astro";
import { devAuthActive, devLogin, DEV_AUTH_COOKIE } from "@/lib/dev-auth";
import { getCookie } from "@/lib/auth-cookies";
import { query } from "@/lib/db";

/**
 * POST /api/auth/dev-login { email, name? }
 *
 * Local-dev-only endpoint (404s outside `astro dev`): accepts ANY password
 * by design — the email finds (or creates) the account in local Postgres
 * and sets the dev cookie. The AuthForm only calls it when devAuthActive().
 */
export const POST: APIRoute = async (ctx) => {
  if (!devAuthActive()) {
    return new Response("Not Found", { status: 404 });
  }

  let body: { email?: string; name?: string };
  try {
    body = await ctx.request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Se requiere un email válido" }, { status: 400 });
  }

  const user = await devLogin(email, body.name);

  const headers = new Headers({
    "Set-Cookie": `${DEV_AUTH_COOKIE}=${user.supabaseAuthId ?? ""}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}`,
  });
  return Response.json({ ok: true, email: user.email }, { headers });
};

// Session probe for the dev indicator — cheap "who am I".
export const GET: APIRoute = async (ctx) => {
  if (!devAuthActive()) {
    return new Response("Not Found", { status: 404 });
  }
  const authId = getCookie(ctx.request.headers.get("cookie") ?? "", DEV_AUTH_COOKIE);
  if (!authId) return Response.json({ user: null });
  const result = await query("SELECT email, name FROM users WHERE supabase_auth_id = $1", [authId]);
  if (result.rows.length === 0) return Response.json({ user: null });
  return Response.json({
    user: {
      email: result.rows[0].email as string,
      name: result.rows[0].name as string,
    },
  });
};
