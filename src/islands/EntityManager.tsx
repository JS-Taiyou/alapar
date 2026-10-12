import { type Signal, useSignal } from "@preact/signals";
import type { Entity } from "../lib/types";
import { initials } from "../lib/format";
import { entitiesChanged } from "./shared-signals";
import Modal from "../components/Modal";

interface EntityManagerProps {
  registryId: string;
  entities: Signal<Entity[]>;
}

export default function EntityManager(props: EntityManagerProps) {
  const isOpen = useSignal(false);
  const entities = props.entities;
  const newName = useSignal("");
  const newColor = useSignal("#6b7280");
  const editingId = useSignal<string | null>(null);
  const editName = useSignal("");
  const editColor = useSignal("");
  const loading = useSignal(false);
  const error = useSignal("");

  async function reload() {
    try {
      const res = await fetch(`/api/entities?registryId=${props.registryId}`);
      if (res.ok) {
        const data = await res.json();
        entities.value = data;
        entitiesChanged.value = { entities: data };
        return;
      }
    } catch {
      // ignore
    }
    entitiesChanged.value = {};
  }

  async function handleCreate() {
    if (!newName.value.trim()) return;
    loading.value = true;
    error.value = "";
    try {
      const res = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.value.trim(),
          color: newColor.value,
          registryId: props.registryId,
        }),
      });
      if (res.ok) {
        newName.value = "";
        newColor.value = "#6b7280";
        await reload();
      } else {
        const data = await res.json();
        error.value = data.error || "Error al crear";
      }
    } catch {
      error.value = "Error de conexión";
    }
    loading.value = false;
  }

  async function handleUpdate() {
    if (!editingId.value || !editName.value.trim()) return;
    loading.value = true;
    error.value = "";
    try {
      const res = await fetch(`/api/entities/${editingId.value}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.value.trim(),
          color: editColor.value,
        }),
      });
      if (res.ok) {
        editingId.value = null;
        await reload();
      } else {
        const data = await res.json();
        error.value = data.error || "Error al actualizar";
      }
    } catch {
      error.value = "Error de conexión";
    }
    loading.value = false;
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este tercero?")) return;
    loading.value = true;
    error.value = "";
    try {
      const res = await fetch(`/api/entities/${id}`, { method: "DELETE" });
      if (res.status === 204) {
        await reload();
      } else {
        const data = await res.json();
        error.value = data.error || "Error al eliminar";
      }
    } catch {
      error.value = "Error de conexión";
    }
    loading.value = false;
  }

  function startEdit(entity: Entity) {
    editingId.value = entity.id;
    editName.value = entity.name;
    editColor.value = entity.color;
  }

  const ENTITY_COLORS = [
    "#6b7280",
    "#f97316",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
    "#eab308",
    "#06b6d4",
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => (isOpen.value = true)}
        class="w-full flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-white justify-center py-2.5 px-3"
      >
        <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </svg>
        <span>Terceros</span>
      </button>

      {isOpen.value && (
        <Modal
          onClose={() => {
            isOpen.value = false;
            editingId.value = null;
          }}
          title="Terceros"
          subtitle="Personas o entidades que participan en gastos"
          footer={
            <div class="ml-auto">
              <button
                type="button"
                onClick={() => {
                  isOpen.value = false;
                  editingId.value = null;
                }}
                class="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cerrar
              </button>
            </div>
          }
        >
          <div class="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
            {error.value && <p class="text-sm text-red-300">{error.value}</p>}

            <div class="flex gap-2">
              <input
                class="flex-1 px-2 py-1 bg-transparent border border-white/20 rounded text-white text-sm focus:ring-primary"
                type="text"
                placeholder="Nombre del tercero"
                value={newName.value}
                onInput={(e) => (newName.value = (e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
              <div class="flex items-center gap-1">
                {ENTITY_COLORS.slice(0, 4).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => (newColor.value = c)}
                    class={`w-6 h-6 rounded-full border-2 ${
                      newColor.value === c ? "border-white" : "border-transparent"
                    }`}
                    style={`background-color: ${c}`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={loading.value || !newName.value.trim()}
                class="px-4 py-2 bg-primary hover:bg-primary-light text-white text-sm font-semibold rounded-custom transition-all active:scale-95 disabled:opacity-50"
              >
                +
              </button>
            </div>

            {entities.value.length === 0 ? (
              <p class="text-sm text-zinc-400 text-center py-4">No hay terceros agregados</p>
            ) : (
              <div class="space-y-2">
                {entities.value.map((entity) => (
                  <div
                    key={entity.id}
                    class="flex items-center gap-3 px-3 py-2 bg-background border border-border-custom rounded-custom"
                  >
                    {editingId.value === entity.id ? (
                      <>
                        <div class="flex items-center gap-1">
                          {ENTITY_COLORS.slice(0, 4).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => (editColor.value = c)}
                              class={`w-5 h-5 rounded-full border-2 ${
                                editColor.value === c ? "border-white" : "border-transparent"
                              }`}
                              style={`background-color: ${c}`}
                            />
                          ))}
                        </div>
                        <input
                          class="flex-1 px-2 py-1 bg-transparent border border-white/20 rounded text-white text-sm focus:ring-primary"
                          type="text"
                          value={editName.value}
                          onInput={(e) => (editName.value = (e.target as HTMLInputElement).value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdate();
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleUpdate}
                          class="text-xs font-semibold text-primary hover:text-primary-light"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => (editingId.value = null)}
                          class="text-xs text-zinc-400 hover:text-white"
                        >
                          X
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={`background-color: ${entity.color}30; color: ${entity.color}`}
                        >
                          {initials(entity.name)}
                        </div>
                        <span class="flex-1 text-sm font-medium text-white">{entity.name}</span>
                        <span class="text-xs px-2 py-0.5 rounded bg-white/10 text-zinc-300">
                          Tercero
                        </span>
                        <button
                          type="button"
                          onClick={() => startEdit(entity)}
                          class="text-zinc-400 hover:text-white transition-colors"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entity.id)}
                          class="text-zinc-400 hover:text-red-400 transition-colors"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
