/** @jsxImportSource react */
import { useState } from "react";
import type { Entity } from "../../lib/types";
import { initials } from "../../lib/format";
import Modal from "../ui/Modal";

interface EntityManagerProps {
  registryId: string;
  entities: Entity[];
  /**
   * Announce the entity list to the owning dashboard shell after a mutation:
   * the new list, or null when the post-mutation refetch itself failed (the
   * shell then refetches on its own).
   */
  onEntitiesChanged: (entities: Entity[] | null) => void;
}

export default function EntityManager(props: EntityManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const entities = props.entities;
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    try {
      const res = await fetch(`/api/entities?registryId=${props.registryId}`);
      if (res.ok) {
        const data = (await res.json()) as Entity[];
        props.onEntitiesChanged(data);
        return;
      }
    } catch {
      // ignore
    }
    props.onEntitiesChanged(null);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          color: newColor,
          registryId: props.registryId,
        }),
      });
      if (res.ok) {
        setNewName("");
        setNewColor("#6b7280");
        await reload();
      } else {
        const data = await res.json();
        setError(data.error || "Error al crear");
      }
    } catch {
      setError("Error de conexión");
    }
    setLoading(false);
  }

  async function handleUpdate() {
    if (!editingId || !editName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/entities/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          color: editColor,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        await reload();
      } else {
        const data = await res.json();
        setError(data.error || "Error al actualizar");
      }
    } catch {
      setError("Error de conexión");
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este tercero?")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/entities/${id}`, { method: "DELETE" });
      if (res.status === 204) {
        await reload();
      } else {
        const data = await res.json();
        setError(data.error || "Error al eliminar");
      }
    } catch {
      setError("Error de conexión");
    }
    setLoading(false);
  }

  function startEdit(entity: Entity) {
    setEditingId(entity.id);
    setEditName(entity.name);
    setEditColor(entity.color);
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
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-custom text-sm font-semibold text-white justify-center py-2.5 px-3"
      >
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        <span>Terceros</span>
      </button>

      {isOpen && (
        <Modal
          onClose={() => {
            setIsOpen(false);
            setEditingId(null);
          }}
          title="Terceros"
          subtitle="Personas o entidades que participan en gastos"
          footer={
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setEditingId(null);
                }}
                className="px-6 py-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
              >
                Cerrar
              </button>
            </div>
          }
        >
          <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
            {error && <p className="text-sm text-red-300">{error}</p>}

            <div className="flex gap-2">
              <input
                className="flex-1 px-2 py-1 bg-transparent border border-white/20 rounded text-white text-sm focus:ring-primary"
                type="text"
                placeholder="Nombre del tercero"
                value={newName}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
              <div className="flex items-center gap-1">
                {ENTITY_COLORS.slice(0, 4).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-6 h-6 rounded-full border-2 ${
                      newColor === c ? "border-white" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={loading || !newName.trim()}
                className="px-4 py-2 bg-primary hover:bg-primary-light text-white text-sm font-semibold rounded-custom transition-all active:scale-95 disabled:opacity-50"
              >
                +
              </button>
            </div>

            {entities.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-4">No hay terceros agregados</p>
            ) : (
              <div className="space-y-2">
                {entities.map((entity) => (
                  <div
                    key={entity.id}
                    className="flex items-center gap-3 px-3 py-2 bg-background border border-border-custom rounded-custom"
                  >
                    {editingId === entity.id ? (
                      <>
                        <div className="flex items-center gap-1">
                          {ENTITY_COLORS.slice(0, 4).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setEditColor(c)}
                              className={`w-5 h-5 rounded-full border-2 ${
                                editColor === c ? "border-white" : "border-transparent"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <input
                          className="flex-1 px-2 py-1 bg-transparent border border-white/20 rounded text-white text-sm focus:ring-primary"
                          type="text"
                          value={editName}
                          onInput={(e) => setEditName(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdate();
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleUpdate}
                          className="text-xs font-semibold text-primary hover:text-primary-light"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs text-zinc-400 hover:text-white"
                        >
                          X
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: `${entity.color}30`, color: entity.color }}
                        >
                          {initials(entity.name)}
                        </div>
                        <span className="flex-1 text-sm font-medium text-white">{entity.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-zinc-300">
                          Tercero
                        </span>
                        <button
                          type="button"
                          onClick={() => startEdit(entity)}
                          className="text-zinc-400 hover:text-white transition-colors"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entity.id)}
                          className="text-zinc-400 hover:text-red-400 transition-colors"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
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
