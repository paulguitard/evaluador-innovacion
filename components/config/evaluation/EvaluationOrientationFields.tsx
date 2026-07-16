"use client";

import type { EvaluationConfig } from "@/lib/evaluation-config";
import { DEFAULT_EVAL_ASSIGNED_LEVEL_PHASE } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import type { ReportFormatConfig } from "@/lib/report-format-config";
import { textareaClass, useEvaluationConfigHelpers } from "./evaluation-config-shared";

const OPTIONAL_SUBDIM_PLACEHOLDER =
  "Opcional. Vacío por defecto: la plantilla user ya define metodología y secciones obligatorias. Solo añade aquí matices extra (se insertan en {{phaseInstructions}}).";

export function EvaluationOrientationFields({
  evaluation,
  rubric,
  reportFormat,
  onChange,
}: {
  evaluation: EvaluationConfig;
  rubric: RubricConfig;
  reportFormat: ReportFormatConfig;
  onChange: (e: EvaluationConfig) => void;
}) {
  const { setPhase } = useEvaluationConfigHelpers({ evaluation, rubric, reportFormat, onChange });

  if (rubric.type === "ponderaciones") {
    return (
      <div className="rounded border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-600 dark:bg-gray-900/40">
        <span className="mb-1 block font-medium text-gray-800 dark:text-gray-200">
          Texto opcional en plantilla (subdimensión)
        </span>
        <p className="mb-1.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
          No duplica la plantilla user. Las instrucciones del formato de informe solo aplican al
          paso de formateo, no a esta evaluación.
        </p>
        <textarea
          className={`${textareaClass} min-h-[72px]`}
          value={evaluation.phaseInstructions.subdimensionEval}
          onChange={(e) => setPhase("subdimensionEval", e.target.value)}
          placeholder={OPTIONAL_SUBDIM_PLACEHOLDER}
        />
        <button
          type="button"
          className="mt-1 text-gray-500 hover:underline"
          onClick={() => setPhase("subdimensionEval", "")}
        >
          Limpiar
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="rounded border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-600 dark:bg-gray-900/40">
        <span className="mb-1 block font-medium text-gray-800 dark:text-gray-200">
          Texto opcional en plantilla (variable)
        </span>
        <p className="mb-1.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
          Vacío por defecto. La plantilla user de variable ya define la estructura obligatoria.
        </p>
        <textarea
          className={`${textareaClass} min-h-[72px]`}
          value={evaluation.phaseInstructions.subdimensionEval}
          onChange={(e) => setPhase("subdimensionEval", e.target.value)}
          placeholder={OPTIONAL_SUBDIM_PLACEHOLDER}
        />
        <button
          type="button"
          className="mt-1 text-gray-500 hover:underline"
          onClick={() => setPhase("subdimensionEval", "")}
        >
          Limpiar
        </button>
      </div>
      <div className="rounded border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-600 dark:bg-gray-900/40">
        <span className="mb-1 block font-medium text-gray-800 dark:text-gray-200">
          Orientación adicional (nivel global)
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
    </>
  );
}
