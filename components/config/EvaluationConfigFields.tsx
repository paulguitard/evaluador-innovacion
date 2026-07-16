"use client";

import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import type { ReportFormatConfig } from "@/lib/report-format-config";
import { EvaluationGeneralFields } from "./evaluation/EvaluationGeneralFields";
import { EvaluationOrientationFields } from "./evaluation/EvaluationOrientationFields";
import { EvaluationPromptsFields } from "./evaluation/EvaluationPromptsFields";
import { EvaluationRagFields } from "./evaluation/EvaluationRagFields";
import { EvaluationLimitsFields } from "./evaluation/EvaluationLimitsFields";
import { EvaluationFormatPromptsFields } from "./evaluation/EvaluationFormatPromptsFields";
import { PromptField, ReadOnlyPromptField, useEvaluationConfigHelpers } from "./evaluation/evaluation-config-shared";

export { EvaluationGeneralFields } from "./evaluation/EvaluationGeneralFields";
export { EvaluationOrientationFields } from "./evaluation/EvaluationOrientationFields";
export { EvaluationPromptsFields } from "./evaluation/EvaluationPromptsFields";
export { EvaluationRagFields } from "./evaluation/EvaluationRagFields";
export { EvaluationLimitsFields } from "./evaluation/EvaluationLimitsFields";
export {
  EvaluationFormatPromptsFields,
  EvaluationReportTokensFields,
} from "./evaluation/EvaluationFormatPromptsFields";

export function EvaluationConfigFields({
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
  const { formatReference, setPrompt } = useEvaluationConfigHelpers({
    evaluation,
    rubric,
    reportFormat,
    onChange,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-xs">
      <p className="shrink-0 text-gray-500 dark:text-gray-400">
        {rubric.type === "ponderaciones"
          ? "Parámetros del proceso IGIP (subdimensiones y dimensiones). Los prompts usan placeholders como {{dimension}}, {{subdimension}}, etc."
          : "Parámetros del proceso IMET (variables y nivel global). Los prompts usan placeholders como {{variable}}, {{levelNumbers}}, etc."}
      </p>

      <EvaluationGeneralFields
        evaluation={evaluation}
        rubric={rubric}
        reportFormat={reportFormat}
        onChange={onChange}
      />

      <EvaluationOrientationFields
        evaluation={evaluation}
        rubric={rubric}
        reportFormat={reportFormat}
        onChange={onChange}
      />

      <details className="shrink-0 rounded border border-gray-200 bg-gray-50/40 p-2 dark:border-gray-600 dark:bg-gray-900/30" open>
        <summary className="cursor-pointer font-medium text-gray-600 dark:text-gray-400">
          Prompts de evaluación (plantillas)
        </summary>
        <div className="mt-2 space-y-2">
          <EvaluationPromptsFields
            evaluation={evaluation}
            rubric={rubric}
            reportFormat={reportFormat}
            onChange={onChange}
          />
          <ReadOnlyPromptField
            label="Plantilla system formateo completo (referencia)"
            hint="Generada desde Formato de informe + Rúbrica. No se edita aquí; es la plantilla base en runtime."
            value={formatReference.fullReportSystem}
          />
          <ReadOnlyPromptField
            label={`Plantilla system por sección — ejemplo: ${formatReference.sectionExampleTitle}`}
            hint="Cada sección del informe usa una variante de esta plantilla al formatear el borrador."
            value={formatReference.sectionExampleSystem}
          />
          <PromptField
            label="Instrucciones extra formateo informe (opcional)"
            hint="Se añaden al system de cada sección. Vacío = sin instrucciones adicionales."
            value={evaluation.prompts.formatInstructions ?? ""}
            onChange={(v) => setPrompt("formatInstructions", v)}
            onRestore={() => setPrompt("formatInstructions", "")}
          />
          <PromptField
            label="Override system formateo (opcional)"
            hint="Texto extra concatenado al system de cada sección. Vacío = solo las plantillas de referencia."
            value={evaluation.prompts.formatSystem ?? ""}
            onChange={(v) => setPrompt("formatSystem", v)}
            onRestore={() => setPrompt("formatSystem", "")}
          />
        </div>
      </details>

      <details className="shrink-0 rounded border border-gray-200 bg-gray-50/40 p-2 dark:border-gray-600 dark:bg-gray-900/30">
        <summary className="cursor-pointer font-medium text-gray-600 dark:text-gray-400">
          Avanzado: tokens, límites de salida y RAG
        </summary>
        <div className="mt-2 space-y-2">
          <EvaluationLimitsFields
            evaluation={evaluation}
            rubric={rubric}
            reportFormat={reportFormat}
            onChange={onChange}
          />
          <EvaluationRagFields
            evaluation={evaluation}
            rubric={rubric}
            reportFormat={reportFormat}
            onChange={onChange}
          />
        </div>
      </details>
    </div>
  );
}
