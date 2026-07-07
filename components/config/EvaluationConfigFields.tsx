"use client";

import type { EvaluationConfig } from "@/lib/evaluation-config";
import {
  DEFAULT_EVAL_ASSIGNED_LEVEL_PHASE,
  DEFAULT_EVAL_SUBDIMENSION_PHASE,
} from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";

const EVAL_TOKEN_LABELS: Partial<Record<keyof EvaluationConfig["maxTokens"], string>> = {
  subdimension: "Subdimensión (evaluación)",
  formatReport: "Formateo informe (§6)",
  scoreJson: "Extracción JSON notas",
  summary: "Síntesis final",
};

const inputClass =
  "w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const textareaClass = `${inputClass} min-h-[72px] resize-y font-mono`;

export function EvaluationConfigFields({
  evaluation,
  rubric,
  onChange,
}: {
  evaluation: EvaluationConfig;
  rubric: RubricConfig;
  onChange: (e: EvaluationConfig) => void;
}) {
  const set = <K extends keyof EvaluationConfig>(key: K, val: EvaluationConfig[K]) =>
    onChange({ ...evaluation, [key]: val });

  const setPhase = (key: keyof EvaluationConfig["phaseInstructions"], val: string) =>
    onChange({
      ...evaluation,
      phaseInstructions: { ...evaluation.phaseInstructions, [key]: val },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-xs">
      <p className="shrink-0 text-gray-500 dark:text-gray-400">
        Parámetros del proceso de evaluación técnica (subdimensiones o nivel global). El resumen
        macro por dimensión se genera en el formateo del informe (§6), no aquí. La profundidad del
        análisis se limita por <strong>tokens</strong> (avanzado).
      </p>

      <div className="grid shrink-0 grid-cols-2 gap-2">
        <label>
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
            Etiqueta índice
          </span>
          <input
            className={inputClass}
            value={evaluation.indicatorLabel}
            onChange={(e) => set("indicatorLabel", e.target.value)}
          />
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
            Etiqueta knowledge
          </span>
          <input
            className={inputClass}
            value={evaluation.knowledgeReferenceLabel}
            onChange={(e) => set("knowledgeReferenceLabel", e.target.value)}
            placeholder="Manual de referencia"
          />
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
            Elementos proyecto en RAG
          </span>
          <input
            type="number"
            className={inputClass}
            min={1}
            max={50}
            value={evaluation.projectElementsInRagQuery}
            onChange={(e) => set("projectElementsInRagQuery", Number(e.target.value))}
          />
        </label>
        <label className="flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={evaluation.parallelSubdimensions}
            onChange={(e) => set("parallelSubdimensions", e.target.checked)}
          />
          Subdimensiones en paralelo
        </label>
        <label className="flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={evaluation.parallelDimensions}
            onChange={(e) => set("parallelDimensions", e.target.checked)}
          />
          Dimensiones en paralelo
        </label>
      </div>

      {rubric.type === "ponderaciones" ? (
        <div className="rounded border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-600 dark:bg-gray-900/40">
          <span className="mb-1 block font-medium text-gray-800 dark:text-gray-200">
            Evaluación por subdimensión
          </span>
          <p className="mb-1 text-[10px] text-gray-500">
            Orientación del análisis técnico por criterio (sin límite de caracteres; solo tokens).
          </p>
          <textarea
            className={`${textareaClass} min-h-[88px]`}
            value={evaluation.phaseInstructions.subdimensionEval}
            onChange={(e) => setPhase("subdimensionEval", e.target.value)}
          />
          <button
            type="button"
            className="mt-1 text-gray-500 hover:underline"
            onClick={() => setPhase("subdimensionEval", DEFAULT_EVAL_SUBDIMENSION_PHASE)}
          >
            Restaurar sugerido
          </button>
        </div>
      ) : (
        <div className="rounded border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-600 dark:bg-gray-900/40">
          <span className="mb-1 block font-medium text-gray-800 dark:text-gray-200">
            Nivel asignado
          </span>
          <textarea
            className={textareaClass}
            value={evaluation.phaseInstructions.assignedLevel}
            onChange={(e) => setPhase("assignedLevel", e.target.value)}
          />
          <button
            type="button"
            className="mt-1 text-gray-500 hover:underline"
            onClick={() => setPhase("assignedLevel", DEFAULT_EVAL_ASSIGNED_LEVEL_PHASE)}
          >
            Restaurar sugerido
          </button>
        </div>
      )}

      <details className="shrink-0 rounded border border-gray-200 bg-gray-50/40 p-2 dark:border-gray-600 dark:bg-gray-900/30">
        <summary className="cursor-pointer font-medium text-gray-600 dark:text-gray-400">
          Avanzado: tokens, RAG y prompts
        </summary>
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(evaluation.maxTokens) as Array<keyof EvaluationConfig["maxTokens"]>)
              .filter((k) => k !== "dimensionOverview")
              .map((k) => (
                <label key={k}>
                  {EVAL_TOKEN_LABELS[k] ?? k}
                  <input
                    type="number"
                    className={inputClass}
                    value={evaluation.maxTokens[k]}
                    onChange={(e) =>
                      set("maxTokens", { ...evaluation.maxTokens, [k]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <label>
              RAG topK
              <input
                type="number"
                className={inputClass}
                value={evaluation.ragEvaluate.topK ?? ""}
                onChange={(e) =>
                  set("ragEvaluate", {
                    ...evaluation.ragEvaluate,
                    topK: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              RAG max chars
              <input
                type="number"
                className={inputClass}
                value={evaluation.ragEvaluate.maxRetrievedChars ?? ""}
                onChange={(e) =>
                  set("ragEvaluate", {
                    ...evaluation.ragEvaluate,
                    maxRetrievedChars: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              System max chars
              <input
                type="number"
                className={inputClass}
                value={evaluation.ragEvaluate.maxSystemChars ?? ""}
                onChange={(e) =>
                  set("ragEvaluate", {
                    ...evaluation.ragEvaluate,
                    maxSystemChars: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="block">
            Prompt JSON notas
            <textarea
              className={textareaClass}
              value={evaluation.prompts.scoreJsonSystem ?? ""}
              onChange={(e) =>
                set("prompts", { ...evaluation.prompts, scoreJsonSystem: e.target.value })
              }
            />
          </label>
          <label className="block">
            Instrucciones formateo informe
            <textarea
              className={textareaClass}
              value={evaluation.prompts.formatInstructions ?? ""}
              onChange={(e) =>
                set("prompts", { ...evaluation.prompts, formatInstructions: e.target.value })
              }
            />
          </label>
        </div>
      </details>
    </div>
  );
}
