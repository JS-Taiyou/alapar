import { useSignal } from "@preact/signals";

export default function JoinCodeForm() {
  const code = useSignal("");

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (code.value.trim()) {
      globalThis.location.href = "/join/" + code.value.trim().toUpperCase();
    }
  }

  return (
    <form onSubmit={handleSubmit} class="flex gap-2">
      <input
        type="text"
        placeholder="Código (ej: K9X2M4B7)"
        class="flex-1 px-4 py-2.5 bg-background border border-white/20 rounded-custom text-white text-sm uppercase focus:ring-emerald-500 focus:border-emerald-500"
        maxLength={8}
        value={code.value}
        onInput={(e) => code.value = (e.target as HTMLInputElement).value}
      />
      <button
        type="submit"
        class="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-custom transition-all text-sm"
      >
        Unirme
      </button>
    </form>
  );
}
