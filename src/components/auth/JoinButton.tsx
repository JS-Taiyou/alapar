/** @jsxImportSource react */
import { useState } from "react";
import { t as translate } from "../../lib/i18n";
import type { Locale } from "../../lib/i18n";

interface JoinButtonProps {
  code: string;
  locale?: Locale;
}

export default function JoinButton(props: JoinButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPlansLink, setShowPlansLink] = useState(false);
  const t = (key: string) => translate(props.locale ?? "es", key);

  async function handleJoin() {
    setLoading(true);
    setError("");
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
        setError(data.error || "Error al unirse");
        // 402 = the group hit its free-plan member cap; offer the pricing
        // page (the OWNER upgrades — the joiner can share the link).
        setShowPlansLink(res.status === 402);
        setLoading(false);
      }
    } catch {
      setError("Error de conexión");
      setShowPlansLink(false);
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleJoin}
        disabled={loading}
        className="w-full py-3 bg-primary hover:bg-primary-light text-white font-semibold rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
      >
        {loading ? "Uniéndote..." : "Unirme al Registro"}
      </button>
      {error && (
        <div className="mt-4">
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-custom px-4 py-3">
            {error}
          </p>
          {showPlansLink && (
            <a
              href="/pricing"
              className="inline-block mt-2 text-sm font-semibold text-primary hover:text-primary-light transition-colors"
            >
              {t("billing.view_plans")} →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
