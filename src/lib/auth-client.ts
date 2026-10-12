/**
 * Client-side session-death detection + automatic logout navigation.
 *
 * WHY THIS EXISTS: when the refresh token expires, the routing middleware
 * answers anonymous requests with a 302 to /login. For PAGE navigations
 * that's perfect — the browser follows it and renders the login screen.
 * But the dashboard is a long-lived PWA whose data path is `fetch()`:
 * fetch follows redirects transparently, so API calls "succeeded" with the
 * login page's HTML (status 200), JSON parsing threw, catch blocks swallowed
 * it, and the screen simply stopped updating — stuck until a manual reload.
 *
 * The fix is two-sided (see main.ts): API paths now answer 401 JSON instead
 * of redirecting, so fetches get a programmatically visible failure. These
 * helpers turn that signal into a real navigation to /login — the same
 * outcome as the manual reload, without the user.
 */

/**
 * True when a fetch response means "the session is gone".
 *
 * - 401: the API-path response for anonymous requests (the primary signal).
 * - followed-redirect-to-login: belt-and-braces for the window where an old
 *   service worker or an in-flight deploy still answers with the 302 —
 *   fetch() then reports redirected=true with the login URL and status 200.
 */
export function isAuthFailure(res: Response): boolean {
  if (res.status === 401) return true;
  return res.redirected && res.url.includes("/login");
}

/**
 * Navigate to the login screen, preserving the current location so the
 * post-login flow returns where the user was (AuthForm forwards ?redirect
 * through the OAuth `next` param).
 *
 * No-op when already on /login (avoids redirect loops) — safe to call from
 * multiple detection points in the same tick.
 */
export function redirectToLogin(): void {
  if (globalThis.location.pathname.startsWith("/login")) return;
  const current = globalThis.location.pathname +
    globalThis.location.search;
  globalThis.location.href = `/login?redirect=${encodeURIComponent(current)}`;
}
