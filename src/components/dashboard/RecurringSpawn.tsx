/** @jsxImportSource react */
import { useState } from "react";
import type { SpawnCandidate } from "../../lib/types";
import { formatMoney } from "../../lib/format";
import Modal from "../ui/Modal";

interface RecurringSpawnProps {
  candidates: SpawnCandidate[];
  isDemo?: boolean;
}

export default function RecurringSpawn(props: RecurringSpawnProps) {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(props.candidates.map((c) => c.id)),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      props.candidates.filter((c) => c.type === "parcialidad").map((c) => [c.id, 1]),
    ),
  );
  const [disabledIds, setDisabledIds] = useState<Set<string>>(() => new Set());

  if (props.candidates.length === 0) return null;

  function toggleItem(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDisableRecurring(id: string) {
    if (!props.isDemo) {
      await fetch("/api/transactions/disable-recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    }
    setDisabledIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function adjustQuantity(id: string, delta: number) {
    const c = props.candidates.find((x) => x.id === id);
    if (!c || c.type !== "parcialidad") return;
    setQuantities((prev) => {
      const cur = prev[id] ?? 1;
      const max =
        c.installmentTotal !== null && c.installmentCurrent !== null
          ? c.installmentTotal - c.installmentCurrent
          : 1;
      const next = Math.max(1, Math.min(cur + delta, max));
      return { ...prev, [id]: next };
    });
  }

  async function handleSpawn() {
    if (props.isDemo) {
      setShowModal(false);
      return;
    }
    setLoading(true);
    const items = [...checkedIds]
      .filter((id) => !disabledIds.has(id))
      .map((id) => ({
        id,
        quantity: quantities[id] ?? 1,
      }));
    if (items.length > 0) {
      try {
        const res = await fetch("/api/exercises/carry-forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) {
          setLoading(false);
          setShowModal(false);
          alert("No se pudieron incluir los gastos recurrentes.");
          return;
        }
      } catch {
        setLoading(false);
        setShowModal(false);
        alert("Error de conexión al incluir gastos recurrentes.");
        return;
      }
    }
    globalThis.location.reload();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCheckedIds(new Set(props.candidates.map((c) => c.id)));
          setShowModal(true);
        }}
        className="p-3 bg-card hover:bg-white/5 transition-colors rounded-custom text-zinc-300 relative"
        title="Recurrentes"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        {props.candidates.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full text-[10px] font-bold text-white flex items-center justify-center">
            {props.candidates.length}
          </span>
        )}
      </button>

      {showModal && (
        <Modal
          onClose={() => setShowModal(false)}
          title="Gastos Recurrentes"
          subtitle="Selecciona cuáles incluir en este periodo."
          widthClass="max-w-lg"
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
                onClick={handleSpawn}
                disabled={loading}
                className="px-8 py-2 text-sm font-semibold bg-primary hover:bg-primary-light text-white rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                {loading ? "Creando..." : "Incluir"}
              </button>
            </div>
          }
        >
          <div className="p-6 space-y-3 overflow-y-auto max-h-[60vh]">
            {props.candidates.map((item) => {
              const isDisabled = disabledIds.has(item.id);
              if (isDisabled) {
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 p-4 bg-background border border-border-custom rounded-custom opacity-40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-400 line-through truncate">
                          {item.description}
                        </span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                          Desactivado
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }

              const maxQty =
                item.type === "parcialidad" &&
                item.installmentTotal !== null &&
                item.installmentCurrent !== null
                  ? item.installmentTotal - item.installmentCurrent
                  : 1;

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-4 p-4 bg-background border border-border-custom rounded-custom hover:bg-white/2 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    className="w-5 h-5 accent-primary rounded shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white truncate">
                        {item.description}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          item.type === "parcialidad"
                            ? "bg-primary/20 text-primary"
                            : "bg-emerald-500/20 text-emerald-400"
                        }`}
                      >
                        {item.type === "parcialidad" ? "Parcialidad" : "Recurrente"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
                      <span>${formatMoney(item.originalAmount)}</span>
                      {item.type === "parcialidad" &&
                        item.installmentCurrent !== null &&
                        item.installmentTotal !== null && (
                          <>
                            <span>&bull;</span>
                            <span className="text-primary">
                              {item.installmentCurrent}/{item.installmentTotal}
                            </span>
                          </>
                        )}
                    </div>
                  </div>
                  {item.type === "parcialidad" && maxQty > 1 && checkedIds.has(item.id) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => adjustQuantity(item.id, -1)}
                        className="w-7 h-7 flex items-center justify-center rounded-custom bg-white/10 text-zinc-300 hover:bg-white/20 transition-colors text-sm font-bold"
                      >
                        -
                      </button>
                      <span className="w-6 text-center text-sm font-semibold text-white">
                        {quantities[item.id] ?? 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => adjustQuantity(item.id, 1)}
                        className="w-7 h-7 flex items-center justify-center rounded-custom bg-white/10 text-zinc-300 hover:bg-white/20 transition-colors text-sm font-bold"
                      >
                        +
                      </button>
                    </div>
                  )}
                  {!checkedIds.has(item.id) && (
                    <button
                      type="button"
                      onClick={() => handleDisableRecurring(item.id)}
                      title="Desactivar recurrente"
                      className="shrink-0 p-1.5 text-zinc-400 hover:text-red-400 transition-colors rounded-custom hover:bg-red-400/10"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          d="M18.364 18.364A9 9 0 015.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
