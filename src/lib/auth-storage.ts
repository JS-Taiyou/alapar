/**
 * Remove every Supabase auth artifact from browser storage.
 *
 * Browser clients are created with `persistSession: false`, so in normal
 * operation nothing auth-related reaches localStorage. The one exception is
 * the PKCE OAuth flow: the code verifier must survive the redirect
 * round-trip, so the OAuth-initiating/callback clients persist to
 * localStorage. This helper wipes the leftovers after a completed exchange
 * and on logout (also catching keys written by older, pre-hardening builds).
 */
export function clearSupabaseBrowserStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const key = globalThis.localStorage.key(i);
      if (key?.startsWith("sb-")) keys.push(key);
    }
    for (const key of keys) globalThis.localStorage.removeItem(key);
  } catch {
    // localStorage unavailable (privacy mode, etc.) — nothing to clear.
  }
}
