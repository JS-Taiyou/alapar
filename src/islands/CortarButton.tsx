import { useSignal } from "@preact/signals";
import Modal from "../components/Modal";

interface CortarButtonProps {
  hasTransactions: boolean;
  registryId: string;
  isDemo?: boolean;
}

export default function CortarButton(props: CortarButtonProps) {
  const loading = useSignal(false);
  const showModal = useSignal(false);
  const canCut = props.hasTransactions;

  if (props.isDemo) return null;

  async function handleCortar() {
    if (!canCut || loading.value) return;
    loading.value = true;
    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: props.registryId }),
      });
      if (!res.ok) {
        loading.value = false;
        alert("No se pudo cortar el ejercicio. Inténtalo de nuevo.");
        return;
      }
      globalThis.location.reload();
    } catch {
      loading.value = false;
      alert("Error de conexión al cortar el ejercicio.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canCut) showModal.value = true;
        }}
        disabled={!canCut}
        class={`px-4 py-2 sm:px-6 sm:py-3 text-sm sm:text-base rounded-custom font-semibold text-white shadow-lg transition-opacity ${
          canCut ? "bg-primary hover:opacity-90" : "bg-slate-700 opacity-50 cursor-not-allowed"
        }`}
      >
        Cortar
      </button>

      {showModal.value && (
        <Modal
          onClose={() => (showModal.value = false)}
          title="Cortar ejercicio"
          subtitle="Esta acción cerrará el periodo actual y no se puede deshacer."
          footer={
            <div class="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => (showModal.value = false)}
                class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCortar}
                disabled={loading.value}
                class="px-8 py-2 text-sm font-semibold bg-primary hover:bg-primary-light text-white rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                {loading.value ? "Cortando..." : "Cortar"}
              </button>
            </div>
          }
        >
          <div class="p-6">
            <p class="text-sm text-zinc-300">
              Se crearán transacciones de ajuste para los saldos pendientes entre los miembros del
              registro.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
