"use client";

import { useState, useEffect } from "react";
import type { BulkEvaluationConfig } from "@/lib/bulk-evaluation-config";
import {
  defaultBulkEvaluationConfig,
  invalidateBulkEvaluationConfigCache,
} from "@/lib/bulk-evaluation-config-client";

export default function BulkConfigModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<BulkEvaluationConfig>(defaultBulkEvaluationConfig());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setMessage(null);
    fetch("/api/bulk-evaluation-config")
      .then((r) => r.json())
      .then((data: BulkEvaluationConfig) => {
        setConfig({ ...defaultBulkEvaluationConfig(), ...data });
      })
      .catch(() => setMessage("No se pudo cargar la configuración masiva."))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/bulk-evaluation-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar");
      setConfig({ ...defaultBulkEvaluationConfig(), ...data });
      invalidateBulkEvaluationConfigCache();
      setMessage("Configuración masiva guardada.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const inputClass =
    "w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
  const labelClass = "text-sm font-medium text-gray-700 dark:text-gray-300";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-600">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Configurar masivo (global)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            Cerrar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : (
            <div className="space-y-5">
              <div>
                <label className={labelClass} htmlFor="parallelProjects">
                  Proyectos en paralelo
                </label>
                <input
                  id="parallelProjects"
                  type="number"
                  min={1}
                  max={8}
                  className={`${inputClass} mt-1`}
                  value={config.parallelProjects}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      parallelProjects: Number(e.target.value) || 1,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Cuántos proyectos se evalúan simultáneamente en modo masivo (1–8).
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={config.useClientKnowledgeIndex}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, useClientKnowledgeIndex: e.target.checked }))
                  }
                />
                <span>
                  <span className={labelClass}>Usar índice RAG local en el navegador</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Descarga el manual una sola vez por equipo; las evaluaciones siguientes no
                    consumen transferencia Blob.
                  </p>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={config.preloadKnowledgeOnBulkStart}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, preloadKnowledgeOnBulkStart: e.target.checked }))
                  }
                />
                <span>
                  <span className={labelClass}>Precargar índice al iniciar lote masivo</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Carga el índice en memoria al empezar el lote (desde disco local si ya existe;
                    sin nueva descarga).
                  </p>
                </span>
              </label>
            </div>
          )}
          {message && (
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">{message}</p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-gray-600">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-2 text-sm dark:border-gray-600"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
