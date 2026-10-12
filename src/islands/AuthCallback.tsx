import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { createClient } from "@supabase/supabase-js";
import AuthCardLayout from "../components/AuthCardLayout";
import { clearSupabaseBrowserStorage } from "./auth-storage";
import { type Locale, t as translate } from "../lib/i18n";

interface AuthCallbackProps {
  redirectPath: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: Locale;
}

export default function AuthCallback(props: AuthCallbackProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const error = useSignal("");
  const debug = useSignal("Initializing...");

  useEffect(() => {
    // Open-redirect guard (also enforced server-side in
    // routes/auth/callback.tsx): only relative same-origin paths.
    const target = /^\/(?!\/)/.test(props.redirectPath)
      ? props.redirectPath
      : "/dashboard";

    const url = new URL(globalThis.location.href);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error_description") ??
      url.searchParams.get("error");

    if (oauthError) {
      debug.value = `Auth error: ${oauthError}`;
      error.value = oauthError;
      return;
    }

    if (!code) {
      debug.value = `No auth code in URL: ${globalThis.location.href}`;
      error.value = t("auth_callback.no_tokens");
      return;
    }

    // PKCE code exchange (supabase-js 2.49+ default flow). persistSession is
    // required only so the client can read the code verifier the OAuth-
    // initiating client left in localStorage — the stored keys are wiped
    // immediately after the exchange; sessions live in HttpOnly cookies.
    const client = createClient(props.supabaseUrl, props.supabaseAnonKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    (async () => {
      try {
        const { data, error: exchangeError } = await client.auth
          .exchangeCodeForSession(code);
        clearSupabaseBrowserStorage();
        if (exchangeError || !data.session) {
          debug.value = `Code exchange failed: ${
            exchangeError?.message ?? "no session"
          }`;
          error.value = t("auth_callback.auth_failed");
          return;
        }

        // The code is single-use and already consumed — strip it from history.
        globalThis.history.replaceState(null, "", "/auth/callback");

        debug.value = "Code exchanged, setting cookies...";

        const res = await fetch("/api/auth/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
          }),
        });
        if (res.ok) {
          globalThis.location.href = target;
        } else if (res.status === 400 || res.status === 401) {
          // Server rejected the tokens — restart the login flow.
          globalThis.location.href = "/login";
        } else {
          const body = await res.text();
          debug.value = `Cookie set failed: ${body}`;
          error.value = `Cookie set failed: ${body}`;
        }
      } catch (err) {
        debug.value = `Auth callback error: ${String(err)}`;
        error.value = String(err);
      }
    })();
  }, []);

  return (
    <AuthCardLayout pageTitle={t("auth_callback.title")} centered>
      {error.value
        ? (
          <>
            <div class="text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-3 text-sm text-center mb-4">
              {error.value}
            </div>
            <details class="mb-6">
              <summary class="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
                {t("auth_callback.technical_details")}
              </summary>
              <pre class="text-xs text-zinc-500 bg-background mt-2 p-3 rounded-custom overflow-auto text-left whitespace-pre-wrap break-all">
                {debug.value}
              </pre>
            </details>
            <a
              href="/login"
              class="block w-full py-3 btn-primary rounded-custom text-center transition-all shadow-lg active:scale-95"
            >
              {t("auth_callback.back_login")}
            </a>
          </>
        )
        : (
          <div class="flex flex-col items-center gap-4 py-4">
            <svg
              class="w-10 h-10 text-primary animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <p class="text-zinc-300 text-sm font-medium">
              {t("auth_callback.authenticating")}
            </p>
          </div>
        )}
    </AuthCardLayout>
  );
}
