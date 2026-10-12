import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Locale, t as translate } from "../../lib/i18n";

interface ForgotPasswordProps {
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: Locale;
}

export default function ForgotPassword(props: ForgotPasswordProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // Created once; null when the Supabase config is missing/invalid (the
  // error banner below renders instead — state may not be set during render).
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setError("");
    setLoading(true);

    try {
      const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: globalThis.location.origin + "/reset-password",
      });
      if (resetError) {
        setError(resetError.message);
        setLoading(false);
        return;
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error_unknown"));
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div className="text-sm text-blue-200 bg-blue-500/20 border border-blue-500/30 rounded-custom px-4 py-3 text-center">
        {t("forgot.success")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="forgot-email">
          {t("auth.email")}
        </label>
        <input
          className="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
          id="forgot-email"
          type="email"
          placeholder={t("auth.email_placeholder")}
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
          required
        />
      </div>

      {(error || !client) && (
        <div className="text-sm text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-2">
          {error || t("common.error_unknown")}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
      >
        {loading ? t("forgot.sending") : t("forgot.submit")}
      </button>

      <p className="text-center text-sm text-zinc-400">
        <a href="/login" className="text-primary hover:underline">
          {t("forgot.back_login")}
        </a>
      </p>
    </form>
  );
}
