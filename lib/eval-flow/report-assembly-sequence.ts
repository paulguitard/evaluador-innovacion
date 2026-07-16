import { isSynthesisSection } from "@/lib/assemble-formatted-report";
import {
  expandReportSections,
  type ReportFormatConfig,
  type ReportSection,
} from "@/lib/report-format-config";
import type { RubricConfig } from "@/lib/rubric-config";

export type ReportAssemblyMethod =
  | "llm_section_format"
  | "verbatim_subdimension"
  | "verbatim_variable"
  | "verbatim_assigned_level"
  | "llm_synthesis";

export type ReportAssemblySequenceStep = {
  order: number;
  title: string;
  method: ReportAssemblyMethod;
  /** Etiqueta corta para la UI del mapa de proceso. */
  methodLabel: string;
  /** Cadena de prompts de la que proviene la plantilla (referencia cruzada). */
  chainId: string;
};

const METHOD_LABELS: Record<ReportAssemblyMethod, string> = {
  llm_section_format: "LLM — formateo por sección",
  verbatim_subdimension: "Sin LLM — copia literal",
  verbatim_variable: "Sin LLM — copia literal",
  verbatim_assigned_level: "Sin LLM — copia literal",
  llm_synthesis: "LLM — síntesis final (prompt distinto)",
};

const CHAIN_BY_METHOD: Record<ReportAssemblyMethod, string> = {
  llm_section_format: "report-per-section",
  verbatim_subdimension: "report-subdim-verbatim",
  verbatim_variable: "report-verbatim",
  verbatim_assigned_level: "report-verbatim",
  llm_synthesis: "report-synthesis",
};

function sectionUsesPerSectionLlm(section: ReportSection): boolean {
  if (section.kind === "dimension_overview") return true;
  if (section.kind === "custom" && !isSynthesisSection(section)) return true;
  return false;
}

function methodForSection(section: ReportSection): ReportAssemblyMethod {
  if (isSynthesisSection(section)) return "llm_synthesis";
  if (section.kind === "subdimension_eval") return "verbatim_subdimension";
  if (section.kind === "variable_eval") return "verbatim_variable";
  if (section.kind === "assigned_level") return "verbatim_assigned_level";
  return "llm_section_format";
}

/** Orden real de ensamblado del informe (paso 5), sección a sección. */
export function buildReportAssemblySequence(
  rubric: RubricConfig,
  reportFormat: ReportFormatConfig
): ReportAssemblySequenceStep[] {
  const sections = expandReportSections(rubric, reportFormat);
  return sections.map((section, index) => {
    const method = methodForSection(section);
    return {
      order: index + 1,
      title: section.title,
      method,
      methodLabel: METHOD_LABELS[method],
      chainId: CHAIN_BY_METHOD[method],
    };
  });
}

/** Secciones que usan la cadena «Formateo LLM por sección» (sin síntesis). */
export function countPerSectionLlmFormats(
  rubric: RubricConfig,
  reportFormat: ReportFormatConfig
): number {
  return expandReportSections(rubric, reportFormat).filter(sectionUsesPerSectionLlm).length;
}

export function perSectionLlmRepeatLabel(
  rubric: RubricConfig,
  reportFormat: ReportFormatConfig
): string {
  const count = countPerSectionLlmFormats(rubric, reportFormat);
  if (count === 0) return "Sin secciones";
  const noun = count === 1 ? "sección" : "secciones";
  const suffix =
    rubric.type === "ponderaciones"
      ? " (resumen + dimensiones)"
      : " (secciones con formateo)";
  return `× ${count} ${noun}${suffix}`;
}
