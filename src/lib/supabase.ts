import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCookie } from "./auth-cookies";
import { env, isDev } from "./env";

const supabaseUrl = env("SUPABASE_URL") ?? "";
const supabaseAnonKey = env("SUPABASE_ANON_KEY") ?? "";
const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Module-level singleton: the JS client is an HTTP client (no connection
// pool to exhaust), and creating one per request just churns fetch/GoTrue
// state on every middleware invocation.
let serverClient: SupabaseClient | null = null;

export function createServerClient(): SupabaseClient {
  serverClient ??= createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serverClient;
}

export function getSupabaseUrl(): string {
  return supabaseUrl;
}

export function getSupabaseAnonKey(): string {
  return supabaseAnonKey;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface AuthResult {
  user: AuthUser;
  refreshedTokens?: { accessToken: string; refreshToken: string };
}

function devLog(...args: unknown[]) {
  if (isDev) console.log("[AUTH]", ...args);
}

export async function getUserFromRequest(req: Request): Promise<AuthResult | null> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const accessToken = getCookie(cookieHeader, "sb-access-token");
  const refreshToken = getCookie(cookieHeader, "sb-refresh-token");
  devLog("Cookies present:", {
    access: !!accessToken,
    refresh: !!refreshToken,
  });

  if (!accessToken) return null;

  const client = createServerClient();

  devLog("Validating access token...");
  const { data, error } = await client.auth.getUser(accessToken);
  if (!error && data.user) {
    devLog("Token valid for:", data.user.email);
    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? "",
        name: data.user.user_metadata?.name as string | undefined,
      },
    };
  }

  devLog("Token invalid:", error?.message);

  if (!refreshToken) return null;

  return await refreshSessionSingleFlight(client, refreshToken);
}

/**
 * In-flight refreshSession promises keyed by refresh token. Supabase rotates
 * refresh tokens on use, so two concurrent requests refreshing with the same
 * token race: the loser gets "Invalid Refresh Token" and the user is
 * spuriously logged out. Sharing one promise per token collapses the race.
 */
const refreshInFlight = new Map<string, Promise<AuthResult | null>>();

async function refreshSessionSingleFlight(
  client: SupabaseClient,
  refreshToken: string,
): Promise<AuthResult | null> {
  const pending = refreshInFlight.get(refreshToken);
  if (pending) return await pending;

  const promise = (async (): Promise<AuthResult | null> => {
    devLog("Attempting token refresh...");
    const { data: refreshData, error: refreshError } = await client.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (refreshError || !refreshData.session || !refreshData.user) {
      devLog("Refresh failed:", refreshError?.message);
      return null;
    }

    devLog("Refresh succeeded for:", refreshData.user.email);
    return {
      user: {
        id: refreshData.user.id,
        email: refreshData.user.email ?? "",
        name: refreshData.user.user_metadata?.name as string | undefined,
      },
      refreshedTokens: {
        accessToken: refreshData.session.access_token,
        refreshToken: refreshData.session.refresh_token,
      },
    };
  })();

  refreshInFlight.set(refreshToken, promise);
  // Drop the entry once settled so the map can't grow unbounded. Explicit
  // reject handler (rather than .finally) to avoid an unhandled rejection
  // on the derived promise.
  promise.then(
    () => refreshInFlight.delete(refreshToken),
    () => refreshInFlight.delete(refreshToken),
  );
  return await promise;
}

// Secure is on by default in production. Local dev runs over plain HTTP,
// where browsers reject Secure cookies, so it stays off there unless
// COOKIE_SECURE=true. COOKIE_SECURE=false forces it off in any environment.
const cookieSecure =
  env("COOKIE_SECURE") !== "false" && (!isDev || env("COOKIE_SECURE") === "true") ? "; Secure" : "";

export function setAuthCookies(headers: Headers, accessToken: string, refreshToken: string): void {
  headers.append(
    "Set-Cookie",
    `sb-access-token=${accessToken}; HttpOnly${cookieSecure}; SameSite=Lax; Path=/; Max-Age=${
      60 * 60 * 24 * 7
    }`,
  );
  headers.append(
    "Set-Cookie",
    `sb-refresh-token=${refreshToken}; HttpOnly${cookieSecure}; SameSite=Lax; Path=/; Max-Age=${
      60 * 60 * 24 * 30
    }`,
  );
}

export function clearAuthCookies(headers: Headers): void {
  headers.append(
    "Set-Cookie",
    `sb-access-token=; HttpOnly${cookieSecure}; SameSite=Lax; Path=/; Max-Age=0`,
  );
  headers.append(
    "Set-Cookie",
    `sb-refresh-token=; HttpOnly${cookieSecure}; SameSite=Lax; Path=/; Max-Age=0`,
  );
}
