import { useState } from "react";
import type { DefaultSplit, User } from "../../lib/types";
import { initials, sanitizeDecimal } from "../../lib/format";
import Modal from "../ui/Modal";
import ProBadge from "../ui/ProBadge";
import type { Locale } from "../../lib/i18n";

interface DefaultSplitConfigProps {
  registryId: string;
  users: User[];
  defaultSplit: DefaultSplit | null;
  isOwner: boolean;
  autoOpen?: boolean;
  onClose?: () => void;
  locale?: Locale;
}

export default function DefaultSplitConfig(props: DefaultSplitConfigProps) {
  const [isOpen, setIsOpen] = useState(props.autoOpen ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const currentMembers = props.users;

  const initialPercentages = (): Record<string, number> => {
    if (props.defaultSplit && props.defaultSplit.splits.length === currentMembers.length) {
      const userIds = new Set(currentMembers.map((u) => u.id));
      const allPresent = props.defaultSplit.splits.every((s) => userIds.has(s.userId));
      if (allPresent) {
        return Object.fromEntries(props.defaultSplit.splits.map((s) => [s.userId, s.percentage]));
      }
    }
    return Object.fromEntries(
      currentMembers.map((u) => [u.id, Math.round((100 / currentMembers.length) * 100) / 100]),
    );
  };

  const [percentages, setPercentages] = useState<Record<string, number>>(initialPercentages);

  function autoComplement(userId: string) {
    if (currentMembers.length === 2) {
      const otherId = currentMembers.find((u) => u.id !== userId)?.id;
      if (otherId) {
        setPercentages((prev) => {
          const newPcts = { ...prev };
          newPcts[otherId] = Math.round((100 - (newPcts[userId] ?? 0)) * 100) / 100;
          return newPcts;
        });
      }
    }
  }

  function totalPercentage(): number {
    return Object.values(percentages).reduce((s, v) => s + v, 0);
  }

  function resetToEqual() {
    setPercentages(
      Object.fromEntries(
        currentMembers.map((u) => [u.id, Math.round((100 / currentMembers.length) * 100) / 100]),
      ),
    );
  }

  async function handleSave() {
    setLoading(true);
    setError("");
    setSuccess(false);

    const total = totalPercentage();
    if (Math.abs(total - 100) >= 0.01) {
      setError(`Los porcentajes suman ${total.toFixed(1)}%, deben sumar 100%`);
      setLoading(false);
      return;
    }

    const splits = currentMembers.map((u) => ({
      userId: u.id,
      percentage: percentages[u.id] ?? 0,
    }));

    try {
      const res = await fetch("/api/registries/default-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: props.registryId, splits }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          closeModal();
        }, 800);
      } else {
        const data = await res.json();
        setError(data.error || "Error al guardar");
      }
    } catch {
      setError("Error de conexión");
    }
    setLoading(false);
  }

  async function handleClear() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/registries/default-split", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: props.registryId }),
      });
      if (res.ok) {
        resetToEqual();
        globalThis.location.reload();
      }
    } catch {
      setError("Error de conexión");
    }
    setLoading(false);
  }

  if (!props.isOwner) return null;

  function closeModal() {
    setIsOpen(false);
    props.onClose?.();
  }

  const total = totalPercentage();
  const isValid = Math.abs(total - 100) < 0.01;

  return (
    <>
      {!props.autoOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-white justify-center py-2.5 px-3"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
          <span>División Default</span>
        </button>
      )}

      {isOpen && (
        <Modal
          onClose={closeModal}
          title="División Default"
          subtitle="Porcentajes predefinidos para nuevos gastos"
          footer={
            <>
              <div>
                {props.defaultSplit && (
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    Eliminar Default
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading || !isValid}
                  className="px-8 py-2 text-sm font-semibold bg-primary hover:bg-primary-light text-white rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
                >
                  {loading ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </>
          }
        >
          <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
            {error && <p className="text-sm text-red-300">{error}</p>}
            {success && <p className="text-sm text-emerald-300">Guardado exitosamente</p>}

            <div className="border border-white/10 rounded-custom overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/5">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-400">MIEMBRO</th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-400 w-32 text-right">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-custom">
                  {currentMembers.map((user) => {
                    const userInitials = initials(user.name);
                    return (
                      <tr key={user.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={{ backgroundColor: `${user.color}30`, color: user.color }}
                            >
                              {userInitials}
                            </div>
                            <span className="text-sm font-medium text-white flex items-center gap-1.5">
                              {user.name}
                              <ProBadge pro={user.pro} locale={props.locale} />
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            <input
                              className="w-16 bg-transparent border-0 text-right text-sm font-medium text-white focus:ring-0 p-0"
                              type="text"
                              inputMode="decimal"
                              value={percentages[user.id] ?? 0}
                              onInput={(e) => {
                                const sanitized = sanitizeDecimal(e.currentTarget.value);
                                e.currentTarget.value = sanitized;
                                const v = parseFloat(sanitized) || 0;
                                setPercentages((prev) => ({ ...prev, [user.id]: v }));
                                autoComplement(user.id);
                              }}
                            />
                            <span className="ml-1 text-zinc-500">%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-white/5">
                  <tr>
                    <td className="px-4 py-2 text-xs font-bold text-zinc-400 italic">TOTAL</td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-bold ${
                        isValid ? "text-white" : "text-red-400"
                      }`}
                    >
                      {total.toFixed(1)}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <button
              type="button"
              onClick={resetToEqual}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Restablecer a equitativo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
