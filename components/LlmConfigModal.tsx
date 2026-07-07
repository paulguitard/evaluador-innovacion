"use client";

import { useState, useEffect } from "react";
import {
  emptyLlmModels,
  emptyLlmParams,
  isLlmModelsComplete,
  LLM_USE_CASE_LABELS,
  LLM_USE_CASES,
  mergeLlmParams,
  type LlmUseCase,
  type LlmUseCaseParams,
} from "@/lib/llm-config-types";

type LlmConfigResponse = {
  models: Record<LlmUseCase, string>;
  params?: Partial<Record<LlmUseCase, LlmUseCaseParams>>;
  hasOpenRouterApiKey: boolean;
  modelsComplete: boolean;
};

export default function LlmConfigModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [models, setModels] = useState<Record<LlmUseCase, string>>(emptyLlmModels());
  const [params, setParams] = useState<Record<LlmUseCase, LlmUseCaseParams>>(emptyLlmParams());
  const [hasOpenRouterApiKey, setHasOpenRouterApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setMessage(null);
    fetch("/api/llm-config")
      .then((r) => r.json())
      .then((data: LlmConfigResponse) => {
        if (data.models) setModels({ ...emptyLlmModels(), ...data.models });
        setParams(mergeLlmParams(data.params));
        setHasOpenRouterApiKey(!!data.hasOpenRouterApiKey);
      })
      .catch(() => setMessage("No se pudo cargar la configuración LLM."))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleSave = async () => {
    if (!isLlmModelsComplete(models)) {
      setMessage("Debe configurar un modelo para cada función.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/llm-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models, params }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar");
      if (data.models) setModels({ ...emptyLlmModels(), ...data.models });
      if (data.params) setParams(mergeLlmParams(data.params));
      setHasOpenRouterApiKey(!!data.hasOpenRouterApiKey);
      setMessage("Configuración LLM guardada.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const inputClass =
    "w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-600">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Configurar LLM
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
            <p className="text-sm text-gray-500 dark:text-gray-400">Cargando…</p>
          ) : (
            <>
              <section className="mb-6">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  API key de OpenRouter
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Se configura únicamente con la variable de entorno{" "}
                  <code className="text-[11px]">OPENROUTER_API_KEY</code> (en{" "}
                  <code className="text-[11px]">.env.local</code> en local o en Vercel en
                  producción).
                </p>
                {hasOpenRouterApiKey ? (
                  <p className="mt-2 text-xs text-green-700 dark:text-green-400">
                    API key detectada en el entorno.
                  </p>
                ) : (
                  <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                    No se detectó <code>OPENROUTER_API_KEY</code>. Añádala al entorno antes de
                    usar el evaluador.
                  </p>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Modelos por función
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  ID de modelo en OpenRouter (ej.{" "}
                  <code className="text-[11px]">openai/gpt-4o</code>). Todos los campos son
                  obligatorios; no hay modelos por defecto.
                </p>
                <div className="mt-3 space-y-4">
                  {LLM_USE_CASES.map((useCase) => (
                    <div key={useCase} className="rounded border border-gray-200 p-3 dark:border-gray-600">
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                        {LLM_USE_CASE_LABELS[useCase]}
                      </label>
                      <input
                        type="text"
                        value={models[useCase] ?? ""}
                        onChange={(e) =>
                          setModels((prev) => ({ ...prev, [useCase]: e.target.value }))
                        }
                        placeholder="proveedor/modelo"
                        className={inputClass}
                        required
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-xs text-gray-600 dark:text-gray-400">
                          Temperatura (0–2)
                          <input
                            type="number"
                            min={0}
                            max={2}
                            step={0.1}
                            value={params[useCase]?.temperature ?? 0}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setParams((prev) => ({
                                ...prev,
                                [useCase]: {
                                  ...prev[useCase],
                                  temperature: Number.isFinite(v) ? v : prev[useCase].temperature,
                                },
                              }));
                            }}
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <label className="text-xs text-gray-600 dark:text-gray-400">
                          max_tokens
                          <input
                            type="number"
                            min={0}
                            max={128000}
                            step={256}
                            value={params[useCase]?.max_tokens ?? 0}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setParams((prev) => ({
                                ...prev,
                                [useCase]: {
                                  ...prev[useCase],
                                  max_tokens: Number.isFinite(v) ? Math.round(v) : prev[useCase].max_tokens,
                                },
                              }));
                            }}
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {message && (
                <p
                  className={`mt-4 text-sm ${
                    message.includes("guardada")
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {message}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-gray-600">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
