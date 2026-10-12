import { useSignal } from "@preact/signals";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Locale, t as translate } from "../lib/i18n";

interface ForgotPasswordProps {
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: Locale;
}

export default function ForgotPassword(props: ForgotPasswordProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const email = useSignal("");
  const error = useSignal("");
  const success = useSignal(false);
  const loading = useSignal(false);

  let client: SupabaseClient;
  try {
    client = createClient(props.supabaseUrl, props.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    error.value = t("common.error_unknown");
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error.value = "";
    loading.value = true;

    try {
      const { error: resetError } = await client.auth.resetPasswordForEmail(email.value, {
        redirectTo: globalThis.location.origin + "/reset-password",
      });
      if (resetError) {
        error.value = resetError.message;
        loading.value = false;
        return;
      }
      success.value = true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : t("common.error_unknown");
    }
    loading.value = false;
  }

  if (success.value) {
    return (
      <div class="text-sm text-blue-200 bg-blue-500/20 border border-blue-500/30 rounded-custom px-4 py-3 text-center">
        {t("forgot.success")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} class="space-y-5">
      <div>
        <label class="block text-sm font-medium text-zinc-300 mb-1.5" for="forgot-email">
          {t("auth.email")}
        </label>
        <input
          class="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
          id="forgot-email"
          type="email"
          placeholder={t("auth.email_placeholder")}
          value={email.value}
          onInput={(e) => (email.value = (e.target as HTMLInputElement).value)}
          required
        />
      </div>

      {error.value && (
        <div class="text-sm text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-2">
          {error.value}
        </div>
      )}

      <button
        type="submit"
        disabled={loading.value}
        class="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
      >
        {loading.value ? t("forgot.sending") : t("forgot.submit")}
      </button>

      <p class="text-center text-sm text-zinc-400">
        <a href="/login" class="text-primary hover:underline">
          {t("forgot.back_login")}
        </a>
      </p>
    </form>
  );
}
