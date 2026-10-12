import { useSignal } from "@preact/signals";
import { t as translate } from "../lib/i18n";
import type { Locale } from "../lib/i18n";

interface JoinButtonProps {
  code: string;
  locale?: Locale;
}

export default function JoinButton(props: JoinButtonProps) {
  const loading = useSignal(false);
  const error = useSignal("");
  const showPlansLink = useSignal(false);
  const t = (key: string) => translate(props.locale ?? "es", key);

  async function handleJoin() {
    loading.value = true;
    error.value = "";
    try {
      const res = await fetch("/api/invitations/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: props.code }),
      });
      const data = await res.json();
      if (data.registryId) {
        globalThis.location.href = "/dashboard";
      } else {
        error.value = data.error || "Error al unirse";
        // 402 = the group hit its free-plan member cap; offer the pricing
        // page (the OWNER upgrades — the joiner can share the link).
        showPlansLink.value = res.status === 402;
        loading.value = false;
      }
    } catch {
      error.value = "Error de conexión";
      showPlansLink.value = false;
      loading.value = false;
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleJoin}
        disabled={loading.value}
        class="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
      >
        {loading.value ? "Uniéndote..." : "Unirme al Registro"}
      </button>
      {error.value && (
        <div class="mt-4">
          <p class="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-custom px-4 py-3">
            {error.value}
          </p>
          {showPlansLink.value && (
            <a
              href="/pricing"
              class="inline-block mt-2 text-sm font-semibold text-primary hover:text-primary-light transition-colors"
            >
              {t("billing.view_plans")} →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
