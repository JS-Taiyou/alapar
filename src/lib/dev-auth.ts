import { env, isDev } from "./env";
import { query } from "./db";
import { rowToUser } from "./rows";
import type { User } from "./types";

/**
 * Local-development auth bypass — "puro email".
 *
 * Active only when `astro dev` runs AND DEV_AUTH != "off": the login form
 * still renders (so the UI can be iterated on) but the password is accepted
 * regardless of what's typed; the supplied email finds the account in the
 * LOCAL Postgres (docker-compose) — or creates it on first sight — and a
 * dev cookie carrying the user's supabase_auth_id stand-in authenticates
 * every subsequent request. No Supabase, no OAuth, no tokens.
 *
 * The middleware treats the dev cookie exactly like a validated Supabase
 * session (everything downstream resolves by supabase_auth_id), so the
 * whole app — registries, transactions, KV-less sync — runs against local
 * Postgres. In production builds `import.meta.env.DEV` is statically false
 * and every call site here compiles away.
 */

export const DEV_AUTH_COOKIE = "alapar-dev-auth";

export function devAuthActive(): boolean {
  return isDev && env("DEV_AUTH") !== "off";
}

/**
 * Find (or create) the local account for an email. Seeded users
 * (db/seed.sql) carry NULL supabase_auth_id — they get a stable dev id
 * derived from their user id on first login.
 */
export async function devLogin(email: string, name?: string): Promise<User> {
  const existing = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    let authId = row.supabase_auth_id as string | null;
    if (!authId) {
      // supabase_auth_id is a UUID column — a plain random one works as the
      // local stand-in (it's persisted, determinism isn't needed).
      authId = crypto.randomUUID();
      await query("UPDATE users SET supabase_auth_id = $1 WHERE id = $2", [authId, row.id]);
    }
    if (name && row.name !== name) {
      await query("UPDATE users SET name = $1 WHERE id = $2", [name, row.id]);
      row.name = name;
    }
    return rowToUser({ ...row, supabase_auth_id: authId });
  }

  // First sight: create the account (same shape createUserFromSupabase
  // produces, with a random UUID auth id).
  const authId = crypto.randomUUID();
  const displayName = name?.trim() || email.split("@")[0];
  const created = await query(
    `INSERT INTO users (email, name, supabase_auth_id, color)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [email, displayName, authId, "#093eaa"],
  );
  return rowToUser(created.rows[0]);
}

/** The fake AuthResult the middleware consumes in dev mode. */
export function devAuthResult(authId: string): {
  user: { id: string; email: string; name: string | null };
  refreshedTokens?: never;
} {
  return { user: { id: authId, email: "(dev)", name: null } };
}
