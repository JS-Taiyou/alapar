/**
 * CSRF decision logic for the middleware chain.
 *
 * Extracted from `src/middleware.ts` so it stays unit-testable (Astro
 * middleware imports `astro:middleware`, which only resolves inside the
 * Astro/Vite pipeline — plain Vitest can't load it). In the Fresh app this
 * was the framework's `csrf()` plugin; the port reimplements it, so the
 * behavior is pinned down here by `csrf.test.ts`.
 *
 * No CSRF exemptions except the Polar webhook: Polar's server posts
 * cross-origin with no browser Origin header, and authenticity is enforced
 * by the Standard Webhooks HMAC signature (see lib/billing.ts), so CSRF
 * protection adds nothing there.
 */
export const CSRF_EXEMPT_PATHS = ["/api/webhooks/polar"] as const;

/**
 * Returns true when the request must be rejected with 403.
 *
 * Rules (matching the old Fresh plugin's behavior):
 *  - GET requests are always allowed (safe methods don't mutate state).
 *  - Requests without an Origin header are allowed (non-browser clients).
 *  - Exempt paths (the Polar webhook) skip the check entirely.
 *  - Otherwise the Origin must match the request's own origin.
 */
export function csrfForbidden(method: string, origin: string | null, url: URL): boolean {
  if (method === "GET") return false;
  if (origin === null) return false;
  if ((CSRF_EXEMPT_PATHS as readonly string[]).includes(url.pathname)) {
    return false;
  }
  return origin !== url.origin;
}
