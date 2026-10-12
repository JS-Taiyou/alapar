import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Locale, t as translate } from "../../lib/i18n";

interface ResetPasswordProps {
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: Locale;
}

export default function ResetPassword(props: ResetPasswordProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  // Created once; null when the Supabase config is missing/invalid (the
  // error card below renders instead — state may not be set during render).
  // The recovery session from setSession() lives only in memory — it is
  // used once to call updateUser() and never persisted to browser storage.
  const [client] = useState<SupabaseClient | null>(() => {
    try {
      return createClient(props.supabaseUrl, props.supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!client) return;
    const hash = globalThis.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");

    if (!accessToken || type !== "recovery") {
      setError(t("reset.invalid_link"));
      return;
    }

    client.auth
      .setSession({
        access_token: accessToken,
        refresh_token: refreshToken ?? "",
      })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError(t("reset.session_failed"));
          return;
        }
        setSessionReady(true);
        globalThis.history.replaceState(null, "", "/reset-password");
      });
    // Runs once on mount: the recovery token is parsed from the URL hash a
    // single time and the result is stored in component state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setError("");

    if (password.length < 6) {
      setError(t("reset.password_too_short"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("reset.password_mismatch"));
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await client.auth.updateUser({
        password: password,
      });
      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error_unknown"));
    }
    setLoading(false);
  }

  if ((error || !client) && !sessionReady) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-3 text-center">
          {error || t("common.error_unknown")}
        </div>
        <a
          href="/forgot-password"
          className="block w-full text-center py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all"
        >
          {t("reset.request_new")}
        </a>
      </div>
    );
  }

  if (!sessionReady) {
    return <div className="text-center text-zinc-400 text-sm py-4">{t("reset.verifying")}</div>;
  }

  if (success) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 rounded-custom px-4 py-3 text-center">
          {t("reset.success")}
        </div>
        <a
          href="/login"
          className="block w-full text-center py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all"
        >
          {t("auth.login")}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="new-password">
          {t("reset.new_password")}
        </label>
        <div className="relative">
          <input
            className="block w-full px-4 py-2.5 pr-11 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
            id="new-password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            minLength={6}
            required
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

      <div>
        <label
          className="block text-sm font-medium text-zinc-300 mb-1.5"
          htmlFor="confirm-password"
        >
          {t("reset.confirm_password")}
        </label>
        <input
          className="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
          id="confirm-password"
          type={showPassword ? "text" : "password"}
          placeholder="••••••••"
          value={confirmPassword}
          onInput={(e) => setConfirmPassword(e.currentTarget.value)}
          minLength={6}
          required
        />
      </div>

      {error && (
        <div className="text-sm text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
      >
        {loading ? t("reset.updating") : t("reset.submit")}
      </button>
    </form>
  );
}
