"use client";

import { useState, useEffect } from "react";
import type { ChatAgentConfig } from "@/lib/chat-agent-config";
import { defaultChatAgentConfig } from "@/lib/chat-agent-config";

export default function AgentConfigModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<ChatAgentConfig>(defaultChatAgentConfig());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setMessage(null);
    fetch("/api/chat-agent-config")
      .then((r) => r.json())
      .then((data: ChatAgentConfig) => {
        setConfig({ ...defaultChatAgentConfig(), ...data });
      })
      .catch(() => setMessage("No se pudo cargar la configuración del agente."))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/chat-agent-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar");
      setConfig({ ...defaultChatAgentConfig(), ...data });
      setMessage("Configuración del agente guardada.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const inputClass =
    "w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
  const textareaClass = `${inputClass} min-h-[100px] resize-y`;

  const rulesToText = (rules: string[]) => rules.join("\n");
  const textToRules = (text: string) =>
    text.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-600">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Configurar agente (global)
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
            <div className="space-y-4 text-sm">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Aplica a toda la aplicación, independiente del tipo de evaluación activo.
              </p>
              <div>
                <label className="mb-1 block font-medium">Prompt del router de contexto</label>
                <textarea
                  className={`${textareaClass} min-h-[200px]`}
                  value={config.routerSystemPrompt}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, routerSystemPrompt: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block font-medium">
                  Reglas respuesta solo Knowledge (una por línea)
                </label>
                <textarea
                  className={textareaClass}
                  value={rulesToText(config.knowledgeResponseRules)}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      knowledgeResponseRules: textToRules(e.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block font-medium">
                  Reglas comparación multi-capítulo (una por línea)
                </label>
                <textarea
                  className={textareaClass}
                  value={rulesToText(config.multiChapterResponseRules)}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      multiChapterResponseRules: textToRules(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-1">
                <div>
                  <label className="mb-1 block font-medium">Regla: knowledge sin rúbrica</label>
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={config.contextHardRules.knowledgeOnlyNoRubric}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        contextHardRules: {
                          ...c.contextHardRules,
                          knowledgeOnlyNoRubric: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium">Regla: comparación capítulos</label>
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={config.contextHardRules.chapterComparisonNoRubric}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        contextHardRules: {
                          ...c.contextHardRules,
                          chapterComparisonNoRubric: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium">Regla: build context sin rúbrica</label>
                  <textarea
                    className={textareaClass}
                    rows={3}
                    value={config.contextHardRules.buildContextNoRubric}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        contextHardRules: {
                          ...c.contextHardRules,
                          buildContextNoRubric: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-medium">Sufijo query Knowledge por defecto</label>
                <input
                  className={inputClass}
                  value={config.defaultKnowledgeQuerySuffix}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, defaultKnowledgeQuerySuffix: e.target.value }))
                  }
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-600">
          {message && (
            <p className="text-xs text-gray-600 dark:text-gray-400">{message}</p>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
