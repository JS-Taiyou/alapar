/** @jsxImportSource react */
import { useState } from "react";
import Modal from "../ui/Modal";

interface CortarButtonProps {
  hasTransactions: boolean;
  registryId: string;
  isDemo?: boolean;
}

export default function CortarButton(props: CortarButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const canCut = props.hasTransactions;

  if (props.isDemo) return null;

  async function handleCortar() {
    if (!canCut || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: props.registryId }),
      });
      if (!res.ok) {
        setLoading(false);
        alert("No se pudo cortar el ejercicio. Inténtalo de nuevo.");
        return;
      }
      globalThis.location.reload();
    } catch {
      setLoading(false);
      alert("Error de conexión al cortar el ejercicio.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canCut) setShowModal(true);
        }}
        disabled={!canCut}
        className={`px-4 py-2 sm:px-6 sm:py-3 text-sm sm:text-base rounded-custom font-semibold text-white shadow-lg transition-opacity ${
          canCut ? "bg-primary hover:opacity-90" : "bg-slate-700 opacity-50 cursor-not-allowed"
        }`}
      >
        Cortar
      </button>

      {showModal && (
        <Modal
          onClose={() => setShowModal(false)}
          title="Cortar ejercicio"
          subtitle="Esta acción cerrará el periodo actual y no se puede deshacer."
          footer={
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCortar}
                disabled={loading}
                className="px-8 py-2 text-sm font-semibold bg-primary hover:bg-primary-light text-white rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                {loading ? "Cortando..." : "Cortar"}
              </button>
            </div>
          }
        >
          <div className="p-6">
            <p className="text-sm text-zinc-300">
              Se crearán transacciones de ajuste para los saldos pendientes entre los miembros del
              registro.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
