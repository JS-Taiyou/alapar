import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { clearSupabaseBrowserStorage } from "../../lib/auth-storage";
import { type Locale, t as translate } from "../../lib/i18n";

interface AuthCallbackProps {
  redirectPath: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: Locale;
}

/**
 * PKCE callback processor. The card chrome lives in auth/callback.astro
 * (AuthCardLayout); this island is only the interactive status content.
 */
export default function AuthCallback(props: AuthCallbackProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const [error, setError] = useState("");
  const [debug, setDebug] = useState("Initializing...");

  useEffect(() => {
    // Open-redirect guard (also enforced server-side in
    // routes/auth/callback.tsx): only relative same-origin paths.
    const target = /^\/(?!\/)/.test(props.redirectPath) ? props.redirectPath : "/dashboard";

    const url = new URL(globalThis.location.href);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

    if (oauthError) {
      setDebug(`Auth error: ${oauthError}`);
      setError(oauthError);
      return;
    }

    if (!code) {
      setDebug(`No auth code in URL: ${globalThis.location.href}`);
      setError(t("auth_callback.no_tokens"));
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
        const { data, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        clearSupabaseBrowserStorage();
        if (exchangeError || !data.session) {
          setDebug(`Code exchange failed: ${exchangeError?.message ?? "no session"}`);
          setError(t("auth_callback.auth_failed"));
          return;
        }

        // The code is single-use and already consumed — strip it from history.
        globalThis.history.replaceState(null, "", "/auth/callback");

        setDebug("Code exchanged, setting cookies...");

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
          setDebug(`Cookie set failed: ${body}`);
          setError(`Cookie set failed: ${body}`);
        }
      } catch (err) {
        setDebug(`Auth callback error: ${String(err)}`);
        setError(String(err));
      }
    })();
    // Runs once on mount: the OAuth code in the URL is single-use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return error ? (
    <>
      <div className="text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-3 text-sm text-center mb-4">
        {error}
      </div>
      <details className="mb-6">
        <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
          {t("auth_callback.technical_details")}
        </summary>
        <pre className="text-xs text-zinc-500 bg-background mt-2 p-3 rounded-custom overflow-auto text-left whitespace-pre-wrap break-all">
          {debug}
        </pre>
      </details>
      <a
        href="/login"
        className="block w-full py-3 btn-primary rounded-custom text-center transition-all shadow-lg active:scale-95"
      >
        {t("auth_callback.back_login")}
      </a>
    </>
  ) : (
    <div className="flex flex-col items-center gap-4 py-4">
      <svg className="w-10 h-10 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <p className="text-zinc-300 text-sm font-medium">{t("auth_callback.authenticating")}</p>
    </div>
  );
}
