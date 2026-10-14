import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearSupabaseBrowserStorage } from "../../lib/auth-storage";
import { type Locale, t as translate } from "../../lib/i18n";

interface AuthFormProps {
  mode: "login" | "signup";
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: Locale;
}

/**
 * Map raw Supabase auth errors to user-facing copy where the raw string is
 * an implementation detail (e.g. "email rate limit exceeded" leaking the
 * sender's quota). Anything unrecognized is shown as-is, as before.
 */
function friendlyAuthError(
  message: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (/rate limit/i.test(message)) return t("auth.rate_limited");
  return message;
}

export default function AuthForm(props: AuthFormProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const redirectParam =
    typeof globalThis.location !== "undefined"
      ? new URL(globalThis.location.href).searchParams.get("redirect")
      : null;
  // Open-redirect guard: only relative same-origin paths are honored.
  const redirectPath =
    redirectParam && /^\/(?!\/)/.test(redirectParam) ? redirectParam : "/dashboard";

  // Local dev: no Supabase at all — the form is for iterating on the UI.
  // Any password is accepted; the email finds (or creates) the local
  // account. See lib/dev-auth.ts.
  const devMode = import.meta.env.DEV;
  let client: SupabaseClient | null = null;
  if (!devMode) {
    try {
      // Email/password sessions are handed straight to the server (which sets
      // HttpOnly cookies) — never persisted to browser storage.
      client = createClient(props.supabaseUrl, props.supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
    } catch {
      return <div className="text-red-400 text-center p-4">{t("common.error_unknown")}</div>;
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);
    try {
      // Dedicated PKCE client for OAuth. persistSession: true is required
      // here (and only here): the PKCE code verifier must survive the
      // redirect round-trip to Google and back, which means web storage.
      // AuthCallback wipes the stored keys once the exchange completes.
      const oauthClient = createClient(props.supabaseUrl, props.supabaseAnonKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { error: oauthError } = await oauthClient.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            globalThis.location.origin + "/auth/callback?next=" + encodeURIComponent(redirectPath),
        },
      });
      if (oauthError) {
        clearSupabaseBrowserStorage();
        setError(oauthError.message);
        setLoading(false);
      }
      // On success the browser navigates away to Google — nothing to clean up.
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error_unknown"));
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (devMode) {
      try {
        const res = await fetch("/api/auth/dev-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name }),
        });
        if (res.ok) {
          globalThis.location.href = redirectPath;
        } else {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? t("common.error_unknown"));
          setLoading(false);
        }
      } catch {
        setError(t("common.error_connection"));
        setLoading(false);
      }
      return;
    }

    try {
      if (props.mode === "signup") {
        // PKCE client for signup: when email confirmation is enabled, the
        // confirmation link redirects to /auth/callback with a ?code= that
        // AuthCallback exchanges using the verifier this client stores —
        // the user lands logged in. (With the implicit-flow client the link
        // returned #access_token=… to the target page, where nothing
        // consumed it: confirmed, but forced to log in again.) Same config
        // as the Google client below, for the same redirect-survival reason.
        const signupClient = createClient(props.supabaseUrl, props.supabaseAnonKey, {
          auth: {
            flowType: "pkce",
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
        const { data, error: signUpError } = await signupClient.auth.signUp({
          email: email,
          password: password,
          options: {
            data: { name: name },
            emailRedirectTo:
              globalThis.location.origin +
              "/auth/callback?next=" +
              encodeURIComponent(redirectPath),
          },
        });
        if (signUpError) {
          clearSupabaseBrowserStorage();
          setError(friendlyAuthError(signUpError.message, t));
          setLoading(false);
          return;
        }
        if (data.session) {
          // Confirmation disabled: we hold the session in memory, cookies
          // carry it from here — nothing may stay in web storage.
          clearSupabaseBrowserStorage();
          await sendCallback(data.session.access_token, data.session.refresh_token);
        } else {
          setSuccessMessage(t("auth.check_email"));
          setLoading(false);
          return;
        }
      } else {
        const { data, error: signInError } = await client!.auth.signInWithPassword({
          email: email,
          password: password,
        });
        if (signInError) {
          setError(friendlyAuthError(signInError.message, t));
          setLoading(false);
          return;
        }
        if (data.session) {
          await sendCallback(data.session.access_token, data.session.refresh_token);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error_unknown"));
      setLoading(false);
    }
  }

  async function sendCallback(accessToken: string, refreshToken: string) {
    try {
      const res = await fetch("/api/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, refreshToken }),
      });
      if (res.ok) {
        globalThis.location.href = redirectPath;
      } else {
        setError(t("auth.session_error"));
        setLoading(false);
      }
    } catch {
      setError(t("common.error_connection"));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {successMessage ? (
        <div className="text-sm text-blue-200 bg-blue-500/20 border border-blue-500/30 rounded-custom px-4 py-3 text-center">
          {successMessage}
        </div>
      ) : (
        <>
          {props.mode === "signup" && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="name">
                {t("auth.name")}
              </label>
              <input
                className="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
                id="name"
                type="text"
                placeholder={t("auth.name_placeholder")}
                value={name}
                onInput={(e) => setName(e.currentTarget.value)}
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="email">
              {t("auth.email")}
            </label>
            <input
              className="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
              id="email"
              type="email"
              placeholder={t("auth.email_placeholder")}
              value={email}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="password">
              {t("auth.password")}
            </label>
            <div className="relative">
              <input
                className="block w-full px-4 py-2.5 pr-11 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder={devMode ? "(dev: cualquier contraseña)" : "••••••••"}
                value={password}
                onInput={(e) => setPassword(e.currentTarget.value)}
                minLength={devMode ? undefined : 6}
                required={!devMode}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? t("auth.hide_password") : t("auth.show_password")}
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-2">
              {error}
            </div>
          )}

          {devMode ? null : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/20 text-white font-medium rounded-custom transition-all flex items-center justify-center gap-3 disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {loading ? t("common.loading") : t("auth.google")}
            </button>
          )}

          {!devMode && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-surface px-3 text-zinc-500">{t("auth.or")}</span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
          >
            {loading
              ? t("common.loading")
              : props.mode === "login"
                ? t("auth.login")
                : t("auth.signup")}
          </button>
        </>
      )}

      {props.mode === "login" && !devMode && (
        <p className="text-center text-sm">
          <a href="/forgot-password" className="text-zinc-400 hover:text-primary hover:underline">
            {t("auth.forgot_link")}
          </a>
        </p>
      )}

      <p className="text-center text-sm text-zinc-400">
        {props.mode === "login" ? (
          <>
            {t("auth.no_account")}{" "}
            <a
              href={`/signup${
                redirectPath !== "/dashboard" ? `?redirect=${encodeURIComponent(redirectPath)}` : ""
              }`}
              className="text-primary hover:underline"
            >
              {t("auth.signup_link")}
            </a>
          </>
        ) : (
          <>
            {t("auth.has_account")}{" "}
            <a
              href={`/login${
                redirectPath !== "/dashboard" ? `?redirect=${encodeURIComponent(redirectPath)}` : ""
              }`}
              className="text-primary hover:underline"
            >
              {t("auth.login_link")}
            </a>
          </>
        )}
      </p>
    </form>
  );
}
