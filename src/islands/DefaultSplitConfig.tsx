import { useSignal } from "@preact/signals";
import type { DefaultSplit, User } from "../lib/types";
import { initials, sanitizeDecimal } from "../lib/format";
import Modal from "../components/Modal";
import ProBadge from "../components/ProBadge";
import type { Locale } from "../lib/i18n";

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
  const isOpen = useSignal(props.autoOpen ?? false);
  const loading = useSignal(false);
  const error = useSignal("");
  const success = useSignal(false);

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

  const percentages = useSignal<Record<string, number>>(initialPercentages());

  function autoComplement(userId: string) {
    if (currentMembers.length === 2) {
      const otherId = currentMembers.find((u) => u.id !== userId)?.id;
      if (otherId) {
        const newPcts = { ...percentages.value };
        newPcts[otherId] = Math.round((100 - (newPcts[userId] ?? 0)) * 100) / 100;
        percentages.value = newPcts;
      }
    }
  }

  function totalPercentage(): number {
    return Object.values(percentages.value).reduce((s, v) => s + v, 0);
  }

  function resetToEqual() {
    percentages.value = Object.fromEntries(
      currentMembers.map((u) => [u.id, Math.round((100 / currentMembers.length) * 100) / 100]),
    );
  }

  async function handleSave() {
    loading.value = true;
    error.value = "";
    success.value = false;

    const total = totalPercentage();
    if (Math.abs(total - 100) >= 0.01) {
      error.value = `Los porcentajes suman ${total.toFixed(1)}%, deben sumar 100%`;
      loading.value = false;
      return;
    }

    const splits = currentMembers.map((u) => ({
      userId: u.id,
      percentage: percentages.value[u.id] ?? 0,
    }));

    try {
      const res = await fetch("/api/registries/default-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: props.registryId, splits }),
      });
      if (res.ok) {
        success.value = true;
        setTimeout(() => {
          closeModal();
        }, 800);
      } else {
        const data = await res.json();
        error.value = data.error || "Error al guardar";
      }
    } catch {
      error.value = "Error de conexión";
    }
    loading.value = false;
  }

  async function handleClear() {
    loading.value = true;
    error.value = "";
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
      error.value = "Error de conexión";
    }
    loading.value = false;
  }

  if (!props.isOwner) return null;

  function closeModal() {
    isOpen.value = false;
    props.onClose?.();
  }

  const total = totalPercentage();
  const isValid = Math.abs(total - 100) < 0.01;

  return (
    <>
      {!props.autoOpen && (
        <button
          type="button"
          onClick={() => (isOpen.value = true)}
          class="w-full flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-white justify-center py-2.5 px-3"
        >
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
          <span>División Default</span>
        </button>
      )}

      {isOpen.value && (
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
                    disabled={loading.value}
                    class="px-4 py-2 text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    Eliminar Default
                  </button>
                )}
              </div>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading.value || !isValid}
                  class="px-8 py-2 text-sm font-semibold bg-primary hover:bg-primary-light text-white rounded-custom transition-all shadow-lg active:scale-95 disabled:opacity-50"
                >
                  {loading.value ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </>
          }
        >
          <div class="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
            {error.value && <p class="text-sm text-red-300">{error.value}</p>}
            {success.value && <p class="text-sm text-emerald-300">Guardado exitosamente</p>}

            <div class="border border-white/10 rounded-custom overflow-hidden">
              <table class="w-full text-left border-collapse">
                <thead class="bg-white/5">
                  <tr>
                    <th class="px-4 py-3 text-xs font-semibold text-zinc-400">MIEMBRO</th>
                    <th class="px-4 py-3 text-xs font-semibold text-zinc-400 w-32 text-right">%</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border-custom">
                  {currentMembers.map((user) => {
                    const userInitials = initials(user.name);
                    return (
                      <tr key={user.id}>
                        <td class="px-4 py-3">
                          <div class="flex items-center gap-3">
                            <div
                              class="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={`background-color: ${user.color}30; color: ${user.color}`}
                            >
                              {userInitials}
                            </div>
                            <span class="text-sm font-medium text-white flex items-center gap-1.5">
                              {user.name}
                              <ProBadge pro={user.pro} locale={props.locale} />
                            </span>
                          </div>
                        </td>
                        <td class="px-4 py-3">
                          <div class="flex items-center justify-end">
                            <input
                              class="w-16 bg-transparent border-0 text-right text-sm font-medium text-white focus:ring-0 p-0"
                              type="text"
                              inputmode="decimal"
                              value={percentages.value[user.id] ?? 0}
                              onInput={(e) => {
                                const sanitized = sanitizeDecimal(
                                  (e.target as HTMLInputElement).value,
                                );
                                (e.target as HTMLInputElement).value = sanitized;
                                const v = parseFloat(sanitized) || 0;
                                percentages.value = {
                                  ...percentages.value,
                                  [user.id]: v,
                                };
                                autoComplement(user.id);
                              }}
                            />
                            <span class="ml-1 text-zinc-500">%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot class="bg-white/5">
                  <tr>
                    <td class="px-4 py-2 text-xs font-bold text-zinc-400 italic">TOTAL</td>
                    <td
                      class={`px-4 py-2 text-right text-xs font-bold ${
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
              class="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Restablecer a equitativo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
