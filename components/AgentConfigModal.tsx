"use client";

import { useState, useEffect, useMemo } from "react";
import type { ChatAgentConfig } from "@/lib/chat-agent-config";
import { defaultChatAgentConfig } from "@/lib/chat-agent-config";
import {
  CHAT_AGENT_UI_CATEGORIES,
  type ChatAgentUiCategoryId,
  type ChatAgentFlowStep,
} from "@/lib/chat-agent-ui-catalog";
import type { AgentToolEntry, AgentToolsCatalogResponse } from "@/lib/agent-tools-catalog";
import {
  CHAT_TOOL_LOOP_SYSTEM_PROMPT,
  CHAT_RESPONSE_BASE_INSTRUCTION,
  CHAT_RESPONSE_LANGUAGE_PREFIX,
} from "@/lib/system-prompts-catalog";

function FlowSteps({ steps }: { steps: ChatAgentFlowStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li
          key={step.id}
          className="relative rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900/50"
        >
          {i < steps.length - 1 && (
            <span
              className="absolute left-[1.15rem] top-full z-0 h-2 w-px bg-gray-300 dark:bg-gray-600"
              aria-hidden
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {step.title}
            </span>
            {step.level && (
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
                Nivel {step.level}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-snug text-gray-600 dark:text-gray-300">
            {step.description}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ToolChip({ tool }: { tool: AgentToolEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-600">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
            {tool.title}
          </span>
          <code className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{tool.name}</code>
        </span>
        <span className="shrink-0 text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-gray-100 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
          <p>{tool.description}</p>
          <p>
            <span className="font-medium text-gray-700 dark:text-gray-200">Uso: </span>
            {tool.usedIn}
          </p>
        </div>
      )}
    </div>
  );
}

function RulesTextarea({
  label,
  hint,
  value,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (rules: string[]) => void;
  className?: string;
}) {
  return (
    <div>
      <label className="mb-1 block font-medium text-gray-800 dark:text-gray-100">{label}</label>
      {hint && <p className="mb-1.5 text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>}
      <textarea
        className={className}
        value={value.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
          )
        }
      />
    </div>
  );
}

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
  const [activeId, setActiveId] = useState<ChatAgentUiCategoryId>("overview");
  const [toolsCatalog, setToolsCatalog] = useState<AgentToolsCatalogResponse | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setMessage(null);
    setActiveId("overview");
    Promise.all([
      fetch("/api/chat-agent-config").then((r) => r.json()),
      fetch("/api/agent-tools").then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Error tools");
        return data as AgentToolsCatalogResponse;
      }),
    ])
      .then(([agentData, toolsData]) => {
        setConfig({ ...defaultChatAgentConfig(), ...agentData });
        setToolsCatalog(toolsData);
      })
      .catch(() => setMessage("No se pudo cargar la configuración del agente."))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const activeCategory =
    CHAT_AGENT_UI_CATEGORIES.find((c) => c.id === activeId) ?? CHAT_AGENT_UI_CATEGORIES[0]!;

  const toolsByName = useMemo(() => {
    const map = new Map<string, AgentToolEntry>();
    for (const cat of toolsCatalog?.categories ?? []) {
      for (const t of cat.tools) map.set(t.name, t);
    }
    return map;
  }, [toolsCatalog]);

  const categoryTools = activeCategory.toolNames
    .map((n) => toolsByName.get(n))
    .filter((t): t is AgentToolEntry => !!t);

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

  const renderEditableFields = () => {
    const fields = activeCategory.editable;
    if (fields.length === 0) return null;

    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Configuración editable
        </h3>
        {fields.includes("routerSystemPrompt") && (
          <div>
            <label className="mb-1 block font-medium">Prompt del router de contexto</label>
            <p className="mb-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              System prompt del planificador Nivel A. Define cómo elegir sources y toolsHint.
            </p>
            <textarea
              className={`${textareaClass} min-h-[220px]`}
              value={config.routerSystemPrompt}
              onChange={(e) =>
                setConfig((c) => ({ ...c, routerSystemPrompt: e.target.value }))
              }
            />
          </div>
        )}
        {fields.includes("knowledgeResponseRules") && (
          <RulesTextarea
            label="Reglas de respuesta — Knowledge (una por línea)"
            hint="Se inyectan cuando el plan es knowledgeOnly."
            className={textareaClass}
            value={config.knowledgeResponseRules}
            onChange={(knowledgeResponseRules) =>
              setConfig((c) => ({ ...c, knowledgeResponseRules }))
            }
          />
        )}
        {fields.includes("multiChapterResponseRules") && (
          <RulesTextarea
            label="Reglas — comparación multi-capítulo (una por línea)"
            className={textareaClass}
            value={config.multiChapterResponseRules}
            onChange={(multiChapterResponseRules) =>
              setConfig((c) => ({ ...c, multiChapterResponseRules }))
            }
          />
        )}
        {fields.includes("bulkResponseRules") && (
          <RulesTextarea
            label="Reglas — evaluación masiva / proyectos (una por línea)"
            hint="Comparaciones, extracts, informes y mejoras de nota entre proyectos evaluados."
            className={textareaClass}
            value={config.bulkResponseRules}
            onChange={(bulkResponseRules) => setConfig((c) => ({ ...c, bulkResponseRules }))}
          />
        )}
        {fields.includes("configResponseRules") && (
          <RulesTextarea
            label="Reglas — configuración del tipo (una por línea)"
            className={textareaClass}
            value={config.configResponseRules}
            onChange={(configResponseRules) => setConfig((c) => ({ ...c, configResponseRules }))}
          />
        )}
        {fields.includes("projectResponseRules") && (
          <RulesTextarea
            label="Reglas — datos de proyecto / extracts (una por línea)"
            className={textareaClass}
            value={config.projectResponseRules}
            onChange={(projectResponseRules) =>
              setConfig((c) => ({ ...c, projectResponseRules }))
            }
          />
        )}
        {fields.includes("contextHardRules") && (
          <div className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-600">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
              Reglas duras de contexto
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium">Knowledge sin rúbrica</label>
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
              <label className="mb-1 block text-xs font-medium">Comparación de capítulos</label>
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
              <label className="mb-1 block text-xs font-medium">Build context sin rúbrica</label>
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
        )}
        {fields.includes("defaultKnowledgeQuerySuffix") && (
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
        )}
      </div>
    );
  };

  const renderCodePrompts = () => {
    if (activeCategory.id !== "prompts_code") return null;
    const prompts = [
      {
        title: "Tool-loop (Nivel B/C)",
        content: CHAT_TOOL_LOOP_SYSTEM_PROMPT,
        note: "lib/system-prompts-catalog.ts → CHAT_TOOL_LOOP_SYSTEM_PROMPT",
      },
      {
        title: "Instrucción base de respuesta",
        content: CHAT_RESPONSE_BASE_INSTRUCTION,
        note: "lib/system-prompts-catalog.ts → CHAT_RESPONSE_BASE_INSTRUCTION",
      },
      {
        title: "Prefijo de idioma (español)",
        content: CHAT_RESPONSE_LANGUAGE_PREFIX.trim(),
        note: "lib/system-prompts-catalog.ts → CHAT_RESPONSE_LANGUAGE_PREFIX",
      },
    ];
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Prompts de sistema (solo lectura)
        </h3>
        {prompts.map((p) => (
          <article
            key={p.title}
            className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-600"
          >
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/80">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.title}</h4>
              <p className="mt-0.5 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                {p.note}
              </p>
            </div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-gray-800 dark:text-gray-200">
              {p.content}
            </pre>
          </article>
        ))}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#252526]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-600">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Configurar agente de chat
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Global · organizado por tipo de pregunta · tools y flujos de encadenado
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            Cerrar
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 py-2 dark:border-gray-600 dark:bg-gray-900/40">
            {CHAT_AGENT_UI_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveId(cat.id)}
                className={`block w-full px-3 py-2 text-left text-xs transition ${
                  activeId === cat.id
                    ? "bg-white font-semibold text-gray-900 shadow-sm dark:bg-[#252526] dark:text-gray-100"
                    : "text-gray-600 hover:bg-white/70 dark:text-gray-400 dark:hover:bg-gray-800/50"
                }`}
              >
                {cat.title}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <p className="text-sm text-gray-500">Cargando…</p>
            ) : (
              <div className="space-y-5 text-sm">
                <header>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {activeCategory.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                    {activeCategory.description}
                  </p>
                </header>

                {activeCategory.exampleQuestions.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                      Ejemplos de pregunta
                    </p>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {activeCategory.exampleQuestions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {activeCategory.sources.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                      Fuentes de contexto típicas
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {activeCategory.sources.map((s) => (
                        <code
                          key={s}
                          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                        >
                          {s}
                        </code>
                      ))}
                    </div>
                  </div>
                )}

                {activeCategory.flowSteps.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Flujo / encadenado
                    </h3>
                    <FlowSteps steps={activeCategory.flowSteps} />
                  </div>
                )}

                {categoryTools.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Tools asociadas
                    </h3>
                    <div className="space-y-2">
                      {categoryTools.map((t) => (
                        <ToolChip key={t.name} tool={t} />
                      ))}
                    </div>
                  </div>
                )}

                {renderEditableFields()}
                {renderCodePrompts()}

                {activeCategory.id === "rubric_score" && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                    La detección de «subir/mejorar nota» y el forzado de rúbrica están en reglas
                    duras del código (<code>asksScoreImprovement</code>). Las reglas de respuesta
                    al comparar con proyectos se editan en «Proyectos y evaluación masiva».
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-gray-600">
          {message ? (
            <p className="text-xs text-gray-600 dark:text-gray-400">{message}</p>
          ) : (
            <span />
          )}
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
  );
}
