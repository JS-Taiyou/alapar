/**
 * Pure routing helpers extracted from the Fresh middleware (`main.ts`).
 *
 * These functions encode two decisions the middleware makes for every request:
 *
 *   1. {@link needsFullState} — whether the request needs the *full* resolved
 *      state (active registry, participants, entities, …) or only the user.
 *      Full-state resolution is the expensive path; lightweight paths skip it.
 *
 *   2. {@link routeGuard} — the auth/redirect rules (login redirect when
 *      anonymous, bounce authed users off login pages, etc.). Returns a
 *      redirect target string, or `null` when the request should fall through
 *      to the route handler.
 *
 * Keeping them here — as pure functions of `(path, flags)` — lets the test
 * suite lock the rules down so a careless edit to `main.ts` can't silently
 * change who gets redirected where.
 *
 * NOTE: `/api/default-split` in {@link needsFullState} is intentionally kept
 * for backward compatibility. The real route lives at
 * `/api/registries/default-split`, which is already covered by the broader
 * `/api/registries` prefix — so the entry is redundant but harmless.
 */

/** Paths that require the full resolved state (user + registry + participants). */
const FULL_STATE_PREFIXES = [
  "/dashboard",
  "/api/billing",
  "/api/registries",
  "/api/transactions",
  "/api/entities",
  "/api/invitations",
  "/api/exercises",
  "/api/default-split",
  "/api/dashboard",
] as const;

/** Public paths reachable without authentication. */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/join",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/api/auth/callback",
  "/api/auth/logout",
  "/api/webhooks/polar",
  "/api/locale",
  "/billing/success",
  "/pricing",
  "/demo",
] as const;

/** Auth pages an already-signed-in user should be bounced away from. */
const AUTH_PAGES: readonly string[] = ["/login", "/signup", "/forgot-password"];

/**
 * Segment-aware prefix match: `path` must equal `prefix` exactly or start with
 * `prefix` followed by `/`. A plain `startsWith` would make `/joinville`
 * match the `/join` prefix (and `/loginx` match `/login`), accidentally
 * turning non-public paths public.
 */
function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/**
 * Returns `true` when `path` must run through {@link resolveUserState}
 * (the expensive full-state path: user + all registries + active registry
 * members + entities). Every entry is a segment-aware prefix match.
 *
 * Note: `"/"` is intentionally **excluded**. The landing page only needs to
 * know whether the user has any registry (to redirect to `/dashboard`) — the
 * middleware resolves that with a single lightweight membership-existence
 * query rather than the full 4-query state resolution.
 */
export function needsFullState(path: string): boolean {
  return FULL_STATE_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

/** Returns `true` when `path` is reachable without authentication. */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

/**
 * Encodes the middleware's auth/redirect rules.
 *
 * @returns the redirect target (a path string) when the request must be
 *   redirected, or `null` when it should fall through to the handler.
 */
export function routeGuard(
  path: string,
  opts: { hasUser: boolean; hasRegistry: boolean },
): string | null {
  const { hasUser, hasRegistry } = opts;

  // Anonymous visitor hitting a protected page → send to login.
  if (!hasUser && !isPublicPath(path)) {
    return `/login?redirect=${encodeURIComponent(path)}`;
  }

  // Signed-in user on an auth page → send to home.
  if (hasUser && AUTH_PAGES.includes(path)) {
    return "/";
  }

  // Signed-in user with no registry trying to reach the dashboard → home.
  if (hasUser && !hasRegistry && path.startsWith("/dashboard")) {
    return "/";
  }

  // Signed-in user with a registry on the landing page → dashboard.
  if (hasUser && hasRegistry && path === "/") {
    return "/dashboard";
  }

  return null;
}
