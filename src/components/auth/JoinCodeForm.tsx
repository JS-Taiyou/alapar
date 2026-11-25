import { useState } from "react";
import { t as translate, type Locale } from "../../lib/i18n";

interface JoinCodeFormProps {
  locale?: Locale;
}

export default function JoinCodeForm(props: JoinCodeFormProps) {
  const [code, setCode] = useState("");
  const t = (key: string) => translate(props.locale ?? "es", key);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim()) {
      globalThis.location.href = "/join/" + code.trim().toUpperCase();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        placeholder={t("join.code_placeholder")}
        className="flex-1 px-4 py-2.5 bg-background border border-border-field rounded-custom text-white text-sm uppercase focus:ring-emerald-500 focus:border-emerald-500"
        maxLength={8}
        value={code}
        onInput={(e) => setCode(e.currentTarget.value)}
      />
      <button
        type="submit"
        className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-custom transition-all text-sm"
      >
        {t("join.submit")}
      </button>
    </form>
  );
}
