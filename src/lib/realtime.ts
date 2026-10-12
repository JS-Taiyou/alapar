import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { redirectToLogin } from "./auth-client";

let supabase: SupabaseClient | null = null;
let activeChannel: RealtimeChannel | null = null;
let activeRegistryId: string | null = null;

type ChangeHandler = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) => void;

let onChange: ChangeHandler | null = null;

/**
 * Catch-up hook, fired every time the channel reaches SUBSCRIBED — including
 * after recovery and after the SDK's own socket-level auto-reconnect.
 *
 * Whatever killed the channel (token expiry, network blip, device sleep) also
 * dropped every postgres_changes event in that window, and resubscribing does
 * NOT replay them: the only way to learn what was missed is to fetch. The
 * registered hook is expected to be stamp-gated (one cheap POST when the
 * registry is already in sync, a full refetch when it isn't).
 */
let onResync: (() => void) | null = null;

/** Register (or clear, with null) the SUBSCRIBED catch-up hook. */
export function setOnResync(cb: (() => void) | null): void {
  onResync = cb;
}

// --- Recovery state -------------------------------------------------------
// When the channel errors (token expiry, network blip, mobile sleep), we
// attempt to recover by fetching a fresh token and resubscribing.
let recovering = false;

/**
 * Channel statuses that warrant an automatic recovery attempt.
 *
 * `CHANNEL_ERROR`: a genuine subscription failure — most commonly an expired
 *   access token failing RLS, which a token refresh fixes.
 * `TIMED_OUT`: the subscribe attempt didn't get an ack in time — worth a retry.
 *
 * `CLOSED` is intentionally **excluded**: the Supabase SDK fires it during
 * normal lifecycle (including when we call removeChannel ourselves), so
 * treating it as recoverable causes a fight with the SDK's own reconnection
 * logic. The SDK auto-reconnects after `CLOSED` on its own.
 */
export const RECOVERABLE_STATUSES = new Set([
  "CHANNEL_ERROR",
  "TIMED_OUT",
]);

/** Maximum recovery attempts before giving up (wake-up path remains as backup). */
export const MAX_RECOVERY_ATTEMPTS = 3;

/** Backoff delay (ms) before the Nth recovery attempt (1-indexed). */
export const RECOVERY_BACKOFF_MS = [1000, 2000, 4000];

/**
 * Pure predicate: should the given channel status trigger a recovery attempt?
 * Exported for unit testing.
 */
export function shouldRecover(status: string): boolean {
  return RECOVERABLE_STATUSES.has(status);
}

/**
 * What a channel status event should trigger. Exported for unit testing.
 *
 * `resync`: SUBSCRIBED — the channel (re)established; events dropped while it
 *   was dead can only be recovered by a fetch, so fire the catch-up hook.
 * `recover`: CHANNEL_ERROR / TIMED_OUT — tear down and resubscribe with a
 *   fresh token.
 * `ignore`: everything else. CLOSED is excluded because the SDK fires it
 *   during normal lifecycle and auto-reconnects on its own.
 */
export function channelStatusAction(
  status: string,
): "resync" | "recover" | "ignore" {
  if (status === "SUBSCRIBED") return "resync";
  if (shouldRecover(status)) return "recover";
  return "ignore";
}

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = (globalThis as Record<string, unknown>)
      .__SUPABASE_URL__ as string;
    const key = (globalThis as Record<string, unknown>)
      .__SUPABASE_ANON_KEY__ as string;
    if (!url || !key) throw new Error("Supabase config missing");
    supabase = createClient(url, key, {
      // No persisted session: the realtime socket is authenticated manually
      // via setAuth() with tokens fetched from /api/auth/token — nothing
      // auth-related belongs in localStorage.
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 2 } },
    });
  }
  return supabase;
}

/**
 * Fetch the current access token from the server.
 *
 * The token lives in an HttpOnly cookie (invisible to JS), so
 * `/api/auth/token` is the seam the client uses both for the initial
 * subscribe and for recovery after expiry. Returns null when the request
 * fails — callers treat that as "retry later".
 *
 * A 401 is different: the middleware already attempted a server-side token
 * refresh before answering, so 401 means the session is DEFINITIVELY dead
 * (refresh token expired/revoked). Retrying is pointless — navigate to
 * /login so the user lands where a manual reload would have taken them,
 * instead of staring at a frozen screen.
 */
async function fetchAccessToken(): Promise<string | null> {
  try {
    const resp = await fetch("/api/auth/token");
    if (resp.status === 401) {
      console.log("[realtime] session expired — redirecting to login");
      redirectToLogin();
      return null;
    }
    if (!resp.ok) {
      console.log("[realtime] token fetch failed:", resp.status);
      return null;
    }
    const { accessToken } = await resp.json() as { accessToken: string };
    return accessToken || null;
  } catch {
    return null;
  }
}

export async function subscribeToRegistry(
  registryId: string,
  handler: ChangeHandler,
  accessToken?: string,
): Promise<void> {
  onChange = handler;

  if (activeRegistryId === registryId && activeChannel) return;

  unsubscribeAll();

  activeRegistryId = registryId;
  const client = getSupabase();

  // When no token is passed (initial subscribe), fetch the current one from
  // the server — tokens are never serialized into page HTML. Recovery passes
  // the fresh token it already fetched.
  const token = accessToken ?? await fetchAccessToken();
  if (token) {
    await client.realtime.setAuth(token);
  }

  activeChannel = client
    .channel(`db-changes-${registryId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "transactions",
        filter: `registry_id=eq.${registryId}`,
      },
      (payload) => {
        if (onChange) {
          onChange({
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            new: payload.new as Record<string, unknown>,
            old: payload.old as Record<string, unknown>,
          });
        }
      },
    )
    .subscribe((status, err) => {
      console.log("[realtime] status:", status, err ?? "");

      const action = channelStatusAction(status);
      if (action === "resync") {
        onResync?.();
        return;
      }

      if (action === "recover" && !recovering) {
        recovering = true;
        void recoverChannel();
      }
    });
}

/**
 * Attempt to recover the realtime channel after a CHANNEL_ERROR / TIMED_OUT.
 *
 * Captures the current registry + handler (before teardown nulls them), fetches
 * a fresh access token from `/api/auth/token` (which triggers a server-side
 * refresh if needed), and resubscribes. Retries with backoff up to
 * {@link MAX_RECOVERY_ATTEMPTS} times.
 *
 * `recovering` stays true for the entire recovery so concurrent status events
 * (e.g. CLOSED from our own removeChannel) can't re-trigger the loop.
 */
async function recoverChannel(): Promise<void> {
  // Capture state before teardown — unsubscribeAll nulls these.
  const rid = activeRegistryId;
  const handler = onChange;
  if (!rid || !handler) {
    recovering = false;
    return;
  }

  // Tear down the broken channel.
  unsubscribeAll();

  for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
    const delay = RECOVERY_BACKOFF_MS[
      Math.min(attempt - 1, RECOVERY_BACKOFF_MS.length - 1)
    ];
    console.log(
      `[realtime] recovery attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS} in ${delay}ms`,
    );
    await new Promise((r) => setTimeout(r, delay));

    try {
      const accessToken = await fetchAccessToken();
      if (!accessToken) continue;

      // Resubscribe with the fresh token. We pass a flag so the SUBSCRIBED
      // handler in subscribeToRegistry doesn't reset `recovering` prematurely —
      // we clear it here only after a successful resubscribe.
      await subscribeToRegistry(rid, handler, accessToken);
      // If we got here, subscribeToRegistry didn't throw. The channel is now
      // connecting; if it reaches SUBSCRIBED it's healthy.
      recovering = false;
      console.log("[realtime] recovery succeeded");
      return;
    } catch (err) {
      console.error(`[realtime] recovery attempt ${attempt} failed:`, err);
    }
  }

  // Exhausted retries — give up. The wake-up/visibilitychange path remains.
  console.warn(
    `[realtime] recovery failed after ${MAX_RECOVERY_ATTEMPTS} attempts; waiting for wake-up path`,
  );
  recovering = false;
}

export function unsubscribeAll(): void {
  if (activeChannel) {
    const client = getSupabase();
    client.removeChannel(activeChannel);
    activeChannel = null;
    activeRegistryId = null;
  }
}

export async function resubscribe(): Promise<void> {
  if (!activeRegistryId || !onChange) return;
  const rid = activeRegistryId;
  const handler = onChange;
  activeRegistryId = null;
  recovering = false;
  await subscribeToRegistry(rid, handler);
}

export function setupRealtimeConfig(
  supabaseUrl: string,
  supabaseAnonKey: string,
): void {
  (globalThis as Record<string, unknown>).__SUPABASE_URL__ = supabaseUrl;
  (globalThis as Record<string, unknown>).__SUPABASE_ANON_KEY__ =
    supabaseAnonKey;
}
