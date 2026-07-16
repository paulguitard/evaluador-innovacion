import type { EvaluationConfig } from "@/lib/evaluation-config";
import { defaultEvaluationConfigForType } from "@/lib/evaluation-config";
import { buildSectionFormatSystemPrompt } from "@/lib/format-report-sections";
import {
  buildFormatSystemPrompt,
  expandReportSections,
  type ReportFormatConfig,
} from "@/lib/report-format-config";
import type { RubricConfig } from "@/lib/rubric-config";
function resolvePrompt(raw: string | undefined, fallback: string | undefined): string {
  return raw?.trim() || fallback?.trim() || "";
}

export type EvaluationFormatPromptReference = {
  fullReportSystem: string;
  sectionExampleSystem: string;
  sectionExampleTitle: string;
};

export function buildEvaluationFormatPromptReference(
  rubric: RubricConfig,
  reportFormat: ReportFormatConfig
): EvaluationFormatPromptReference {
  const sections = expandReportSections(rubric, reportFormat);
  const example =
    sections.find((s) => s.kind === "subdimension_eval" || s.kind === "variable_eval") ??
    sections.find((s) => s.kind === "custom") ??
    sections[0];

  return {
    fullReportSystem: buildFormatSystemPrompt(reportFormat, rubric),
    sectionExampleSystem: example
      ? buildSectionFormatSystemPrompt(example, rubric)
      : "(Sin secciones en el formato de informe actual.)",
    sectionExampleTitle: example?.title ?? "—",
  };
}

/** Rellena prompts vacíos con los valores efectivos usados en runtime (solo para UI / carga). */
export function enrichEvaluationPromptsForDisplay(
  evaluation: EvaluationConfig,
  rubric: RubricConfig,
  typeName?: string
): EvaluationConfig {
  const typeDefaults = defaultEvaluationConfigForType(typeName ?? evaluation.indicatorLabel);

  return {
    ...evaluation,
    prompts: {
      ...evaluation.prompts,
      subdimensionUser: resolvePrompt(
        evaluation.prompts.subdimensionUser,
        typeDefaults.prompts.subdimensionUser
      ),
      subdimensionSystem: resolvePrompt(
        evaluation.prompts.subdimensionSystem,
        typeDefaults.prompts.subdimensionSystem
      ),
      variableEval: resolvePrompt(evaluation.prompts.variableEval, typeDefaults.prompts.variableEval),
      assignLevel: resolvePrompt(evaluation.prompts.assignLevel, typeDefaults.prompts.assignLevel),
      globalLevel: resolvePrompt(evaluation.prompts.globalLevel, typeDefaults.prompts.globalLevel),
    },
  };
}
