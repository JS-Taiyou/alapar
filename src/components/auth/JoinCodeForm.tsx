/** @jsxImportSource react */
import { useState } from "react";

export default function JoinCodeForm() {
  const [code, setCode] = useState("");

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
        placeholder="Código (ej: K9X2M4B7)"
        className="flex-1 px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white text-sm uppercase focus:ring-emerald-500 focus:border-emerald-500"
        maxLength={8}
        value={code}
        onInput={(e) => setCode(e.currentTarget.value)}
      />
      <button
        type="submit"
        className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-custom transition-all text-sm"
      >
        Unirme
      </button>
    </form>
  );
}
