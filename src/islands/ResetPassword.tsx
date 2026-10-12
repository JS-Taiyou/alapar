import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Locale, t as translate } from "../lib/i18n";

interface ResetPasswordProps {
  supabaseUrl: string;
  supabaseAnonKey: string;
  locale?: Locale;
}

export default function ResetPassword(props: ResetPasswordProps) {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(props.locale ?? "es", key, params);

  const password = useSignal("");
  const confirmPassword = useSignal("");
  const showPassword = useSignal(false);
  const error = useSignal("");
  const success = useSignal(false);
  const loading = useSignal(false);
  const sessionReady = useSignal(false);

  let client: SupabaseClient;
  try {
    // The recovery session from setSession() lives only in memory — it is
    // used once to call updateUser() and never persisted to browser storage.
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

  useEffect(() => {
    const hash = globalThis.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");

    if (!accessToken || type !== "recovery") {
      error.value = t("reset.invalid_link");
      return;
    }

    client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? "",
    }).then(({ error: sessionError }) => {
      if (sessionError) {
        error.value = t("reset.session_failed");
        return;
      }
      sessionReady.value = true;
      globalThis.history.replaceState(null, "", "/reset-password");
    });
  }, []);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error.value = "";

    if (password.value.length < 6) {
      error.value = t("reset.password_too_short");
      return;
    }
    if (password.value !== confirmPassword.value) {
      error.value = t("reset.password_mismatch");
      return;
    }

    loading.value = true;

    try {
      const { error: updateError } = await client.auth.updateUser({
        password: password.value,
      });
      if (updateError) {
        error.value = updateError.message;
        loading.value = false;
        return;
      }
      success.value = true;
    } catch (err) {
      error.value = err instanceof Error
        ? err.message
        : t("common.error_unknown");
    }
    loading.value = false;
  }

  if (error.value && !sessionReady.value) {
    return (
      <div class="space-y-4">
        <div class="text-sm text-red-300 bg-red-500/20 border border-red-500/30 rounded-custom px-4 py-3 text-center">
          {error.value}
        </div>
        <a
          href="/forgot-password"
          class="block w-full text-center py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all"
        >
          {t("reset.request_new")}
        </a>
      </div>
    );
  }

  if (!sessionReady.value) {
    return (
      <div class="text-center text-zinc-400 text-sm py-4">
        {t("reset.verifying")}
      </div>
    );
  }

  if (success.value) {
    return (
      <div class="space-y-4">
        <div class="text-sm text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 rounded-custom px-4 py-3 text-center">
          {t("reset.success")}
        </div>
        <a
          href="/login"
          class="block w-full text-center py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all"
        >
          {t("auth.login")}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} class="space-y-5">
      <div>
        <label
          class="block text-sm font-medium text-zinc-300 mb-1.5"
          for="new-password"
        >
          {t("reset.new_password")}
        </label>
        <div class="relative">
          <input
            class="block w-full px-4 py-2.5 pr-11 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
            id="new-password"
            type={showPassword.value ? "text" : "password"}
            placeholder="••••••••"
            value={password.value}
            onInput={(e) =>
              password.value = (e.target as HTMLInputElement).value}
            minLength={6}
            required
          />
          <button
            type="button"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
            onClick={() => showPassword.value = !showPassword.value}
            tabIndex={-1}
            aria-label={showPassword.value
              ? t("auth.hide_password")
              : t("auth.show_password")}
          >
            {showPassword.value
              ? (
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18"
                  />
                </svg>
              )
              : (
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
          </button>
        </div>
      </div>

      <div>
        <label
          class="block text-sm font-medium text-zinc-300 mb-1.5"
          for="confirm-password"
        >
          {t("reset.confirm_password")}
        </label>
        <input
          class="block w-full px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white focus:ring-primary focus:border-primary"
          id="confirm-password"
          type={showPassword.value ? "text" : "password"}
          placeholder="••••••••"
          value={confirmPassword.value}
          onInput={(e) =>
            confirmPassword.value = (e.target as HTMLInputElement).value}
          minLength={6}
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
        {loading.value ? t("reset.updating") : t("reset.submit")}
      </button>
    </form>
  );
}
