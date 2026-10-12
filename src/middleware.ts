import { defineMiddleware, sequence } from "astro:middleware";
import { createUserFromSupabase, resolveUserState } from "@/lib/store";
import { getUserFromRequest, setAuthCookies } from "@/lib/supabase";
import { getCookie } from "@/lib/auth-cookies";
import { query, setRuntimeConnectionString } from "@/lib/db";
import { needsFullState, routeGuard } from "@/lib/routing";
import { resolveLocale } from "@/lib/i18n";
import { getRegistryPlan, USER_PRO_SQL } from "@/lib/entitlements";
import { csrfForbidden } from "@/lib/csrf";
import { isDev } from "@/lib/env";

function devLog(...args: unknown[]) {
  if (isDev) console.log("[MW]", ...args);
}

// Cloudflare Workers: resource bindings (Hyperdrive, KV, DO…) are objects on
// the request-scoped `env`, not strings in process.env — lib/db.ts can't see
// them at module scope. Register the Hyperdrive connection string here, once
// per isolate, before any query runs. On any other runtime locals.runtime is
// undefined and this is a no-op (db falls back to DATABASE_URL / local).
const registerRuntimeBindings = defineMiddleware(async (context, next) => {
  const runtimeEnv = (context.locals as { runtime?: { env?: Record<string, unknown> } } | undefined)
    ?.runtime?.env;
  const hyperdrive = runtimeEnv?.HYPERDRIVE as { connectionString?: string } | undefined;
  if (hyperdrive?.connectionString) {
    setRuntimeConnectionString(hyperdrive.connectionString);
  }
  return next();
});

// The decision logic lives in lib/csrf.ts (unit-testable); the exempt path
// list and its Polar rationale are documented there.
const csrf = defineMiddleware(async (context, next) => {
  const origin = context.request.headers.get("origin");
  if (csrfForbidden(context.request.method, origin, context.url)) {
    return new Response("Forbidden", { status: 403 });
  }
  return next();
});

// Security headers on every response. No CSP: islands rely on
// inline scripts.
const securityHeaders = defineMiddleware(async (_context, next) => {
  const response = await next();
  const headers = response.headers;
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
});

// Minimal per-IP sliding-window rate limit for the most abuse-prone public
// endpoints (invite acceptance + auth endpoints).
// Caveat: on Workers each isolate keeps its own Map, so the limit is
// per-isolate rather than global — a first-line throttle, not a hard cap.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitHits = new Map<string, number[]>();
let rateLimitLastSweep = Date.now();

function isRateLimitedRoute(path: string, method: string): boolean {
  if (method === "GET" && (path === "/join" || path.startsWith("/join/"))) {
    return true;
  }
  if (method !== "POST") return false;
  return path === "/api/invitations/join" || path === "/api/auth/callback";
}

const rateLimit = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (!isRateLimitedRoute(path, context.request.method)) return next();

  const now = Date.now();
  // Periodic sweep so the Map can't grow unbounded.
  if (now - rateLimitLastSweep > RATE_LIMIT_WINDOW_MS) {
    rateLimitLastSweep = now;
    for (const [ip, hits] of rateLimitHits) {
      const fresh = hits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) rateLimitHits.delete(ip);
      else rateLimitHits.set(ip, fresh);
    }
  }

  const ip = context.request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const hits = (rateLimitHits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    return new Response("Too Many Requests", { status: 429 });
  }
  hits.push(now);
  rateLimitHits.set(ip, hits);
  return await next();
});

const authState = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const req = context.request;
  devLog(`>> REQUEST ${req.method} ${path}`);

  context.locals.user = null;
  context.locals.activeRegistry = null;
  context.locals.registries = [];
  context.locals.registryUsers = [];
  context.locals.entities = [];
  context.locals.participants = [];
  context.locals.supabaseAuthId = null;
  context.locals.accessToken = null;
  context.locals.isOwner = false;
  context.locals.ownerRegistryIds = new Set<string>();
  context.locals.locale = resolveLocale(
    getCookie(req.headers.get("cookie") ?? "", "alapar-locale"),
    req.headers.get("accept-language"),
  );
  context.locals.activeRegistryPlan = null;

  // /demo renders entirely from static JSON — skip auth + DB entirely.
  if (path === "/demo") {
    devLog("  Demo page, skipping auth");
    const response = await next();
    devLog(`<< RESPONSE ${req.method} ${path} (demo, status=${response?.status})`);
    return response;
  }

  devLog("  Getting user from request...");
  const authResult = await getUserFromRequest(req);
  if (!authResult) {
    devLog("  No auth result, continuing without user");
    const response = await next();
    devLog(`<< RESPONSE ${req.method} ${path} (no user, status=${response?.status})`);
    return response;
  }

  const authUser = authResult.user;
  context.locals.supabaseAuthId = authUser.id;
  // Stash the validated access token (the refreshed one when the middleware
  // just renewed it) so /api/auth/token can serve it without re-validating
  // against possibly-spent cookies.
  context.locals.accessToken =
    authResult.refreshedTokens?.accessToken ??
    getCookie(req.headers.get("cookie") ?? "", "sb-access-token");
  devLog(`  Authed user: ${authUser.email}`);

  const fullStateNeeded = needsFullState(path);

  if (!fullStateNeeded) {
    devLog("  Lightweight path, querying user...");
    const userResult = await query(
      `SELECT u.*, ${USER_PRO_SQL} FROM users u WHERE u.supabase_auth_id = $1`,
      [authUser.id],
    );
    if (userResult.rows.length === 0) {
      // First request from a never-seen Supabase user: open signup (the app
      // is public — any authenticated Google user gets a profile).
      const user = await createUserFromSupabase(
        authUser.id,
        authUser.email,
        authUser.name ?? authUser.email.split("@")[0],
      );
      context.locals.user = user;
      devLog("  Created new user:", user.email);
    } else {
      const row = userResult.rows[0];
      if (authUser.name && row.name !== authUser.name) {
        await query("UPDATE users SET name = $1 WHERE supabase_auth_id = $2", [
          authUser.name,
          authUser.id,
        ]);
        row.name = authUser.name;
      }
      context.locals.user = {
        id: row.id as string,
        email: row.email as string,
        name: row.name as string,
        color: row.color as string,
        supabaseAuthId: row.supabase_auth_id as string,
        createdAt: row.created_at as Date,
        pro: (row.pro as "subscribed" | "grandfathered" | null) ?? null,
      };
    }
    const response = await next();
    devLog(`<< RESPONSE ${req.method} ${path} (lightweight, status=${response?.status})`);
    if (authResult.refreshedTokens && response) {
      devLog("  Setting refreshed cookies");
      setAuthCookies(
        response.headers,
        authResult.refreshedTokens.accessToken,
        authResult.refreshedTokens.refreshToken,
      );
    }
    return response;
  }

  devLog("  Full state path, resolving...");
  const state = await resolveUserState(authUser.id);
  devLog("  State resolved, user:", state.user?.email, "hasRegistry:", !!state.activeRegistry);

  if (!state.user) {
    // First request from a never-seen Supabase user: open signup.
    const user = await createUserFromSupabase(
      authUser.id,
      authUser.email,
      authUser.name ?? authUser.email.split("@")[0],
    );
    context.locals.user = user;
    const response = await next();
    if (authResult.refreshedTokens && response) {
      setAuthCookies(
        response.headers,
        authResult.refreshedTokens.accessToken,
        authResult.refreshedTokens.refreshToken,
      );
    }
    return response;
  }

  if (authUser.name && state.user.name !== authUser.name) {
    await query("UPDATE users SET name = $1 WHERE id = $2", [authUser.name, state.user.id]);
    state.user = { ...state.user, name: authUser.name };
  }

  context.locals.user = state.user;
  context.locals.registries = state.registries;
  context.locals.activeRegistry = state.activeRegistry;
  context.locals.registryUsers = state.registryUsers;
  context.locals.entities = state.entities;
  context.locals.participants = state.participants;
  context.locals.isOwner = state.isOwner;
  context.locals.ownerRegistryIds = state.ownerRegistryIds;

  // Plan of the active registry (1 extra query on full-state paths only) —
  // lets pages/islands render upgrade CTAs without re-querying.
  context.locals.activeRegistryPlan = state.activeRegistry
    ? await getRegistryPlan(state.activeRegistry.id)
    : null;

  const response = await next();
  if (authResult.refreshedTokens && response) {
    setAuthCookies(
      response.headers,
      authResult.refreshedTokens.accessToken,
      authResult.refreshedTokens.refreshToken,
    );
  }
  return response;
});

const guard = defineMiddleware(async (context, next) => {
  const path2 = context.url.pathname;
  const hasUser = context.locals.user !== null;
  let hasRegistry = context.locals.activeRegistry !== null;

  // On the lightweight path (e.g. "/"), activeRegistry isn't resolved. Do a
  // single cheap existence check so we can still redirect authed users with a
  // registry to /dashboard without the full 4-query resolveUserState.
  if (hasUser && !hasRegistry && path2 === "/") {
    const membership = await query("SELECT 1 FROM registry_members WHERE user_id = $1 LIMIT 1", [
      context.locals.user!.id,
    ]);
    hasRegistry = membership.rows.length > 0;
  }

  devLog(
    `>> ROUTING ${context.request.method} ${path2} hasUser=${hasUser} hasRegistry=${hasRegistry}`,
  );

  const redirect = routeGuard(path2, { hasUser, hasRegistry });
  if (redirect) {
    // API paths answer 401 JSON instead of redirecting: the dashboard's
    // data path is fetch(), which follows redirects transparently — a 302
    // to /login would arrive as status-200 HTML, JSON parsing would throw
    // into silent catch blocks, and a dead session would just freeze the
    // UI. A 401 is a visible signal the client turns into a real logout
    // navigation (lib/auth-client.ts). Page routes keep the redirect.
    if (path2.startsWith("/api/")) {
      devLog(`<< ROUTING 401 (api, no user)`);
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    devLog(`<< ROUTING redirect to ${redirect}`);
    return context.redirect(redirect);
  }

  devLog(`<< ROUTING ${context.request.method} ${path2} continuing to handler`);
  return await next();
});

export const onRequest = sequence(
  registerRuntimeBindings,
  csrf,
  securityHeaders,
  rateLimit,
  authState,
  guard,
);
