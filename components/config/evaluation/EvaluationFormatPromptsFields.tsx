"use client";

import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import type { ReportFormatConfig } from "@/lib/report-format-config";
import { PromptField, ReadOnlyPromptField, useEvaluationConfigHelpers } from "./evaluation-config-shared";
import { EvaluationLimitsFields } from "./EvaluationLimitsFields";

export function EvaluationFormatPromptsFields({
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
    <div className="space-y-2">
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
  );
}

export function EvaluationReportTokensFields({
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
  const { set } = useEvaluationConfigHelpers({ evaluation, rubric, reportFormat, onChange });

  return (
    <div className="space-y-2">
      <label>
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
          Ratio mín. caracteres (informe)
        </span>
        <input
          type="number"
          step={0.05}
          min={0.5}
          max={1}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          value={evaluation.charRangeMinRatio}
          onChange={(e) => set("charRangeMinRatio", Number(e.target.value))}
        />
      </label>
      <EvaluationLimitsFields
        evaluation={evaluation}
        rubric={rubric}
        reportFormat={reportFormat}
        onChange={onChange}
        tokenKeys={["formatReport", "summary"]}
      />
    </div>
  );
}
