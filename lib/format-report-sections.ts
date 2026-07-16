import { extractSubdimensionSection } from "@/lib/evaluation-scores";
import type { RubricConfig } from "@/lib/rubric-config";
import { EVALUATION_REPORT_LANGUAGE_BULLET } from "@/lib/system-prompts-catalog";
import { extractGlobalLevelSection, extractVariableSection } from "@/lib/rubric-niveles";
import {
  condenseProjectElementsForPrompt,
  type ReportCustomSection,
  type ReportSection,
} from "@/lib/report-format-config";

/** Tokens de salida para generar la sección completa sin cortar a mitad de frase.
 *  Reserva un buffer amplio (+2560) para modelos de reasoning que consumen 1000-3000
 *  tokens en thinking invisible antes de emitir el primer token de content. */
export function estimateSectionMaxTokens(section: ReportSection): number {
  const targetChars = Math.max(section.minChars, section.maxChars);
  const estimated = Math.ceil(targetChars / 1.2) + 2560;
  return Math.min(8192, Math.max(2560, estimated));
}

/** Cuerpo de la sección sin encabezado markdown. */
export function extractSectionBody(text: string, title: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutHeader = trimmed.replace(
    new RegExp(`^#{1,3}\\s*${escaped}\\s*\\n+`, "i"),
    ""
  );
  return withoutHeader.trim();
}

/** Detecta texto cortado a mitad de idea (sin cierre de oración). */
export function isSectionTextComplete(body: string, minChars: number): boolean {
  const t = body.trim();
  if (t.length < minChars) return false;
  return !isSectionTextTruncated(t);
}

const SECTION_CLOSURE_RE = /[.!?»")\]\u2026]$/;

function paragraphEndsCleanly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (SECTION_CLOSURE_RE.test(t)) return true;
  if (/\*\*[^*]+\*\*$/.test(t)) return true;
  if (/\)$/.test(t) && /[.!?]/.test(t)) return true;
  return false;
}

/** Quita reglas horizontales markdown (`---`, `***`, `___`) del final de un texto. */
function stripTrailingMarkdownSeparators(text: string): string {
  return text.replace(/(?:\n+)?\s*(?:-{3,}|\*{3,}|_{3,})\s*$/g, "").trimEnd();
}

export function isSectionTextTruncated(body: string): boolean {
  const t = stripTrailingMarkdownSeparators(body.trim());
  if (!t) return true;
  if (paragraphEndsCleanly(t)) return false;

  const paragraphs = t
    .split(/\n\s*\n/)
    .map((p) => stripTrailingMarkdownSeparators(p.trim()))
    .filter(Boolean);
  const lastParagraph = paragraphs.at(-1) ?? t;
  if (paragraphEndsCleanly(lastParagraph)) return false;

  if (paragraphs.length > 1) {
    const prev = paragraphs.at(-2) ?? "";
    if (paragraphEndsCleanly(prev) && lastParagraph.length <= 80) {
      if (/^#{1,3}\s/.test(lastParagraph)) return false;
      if (/^\*\*[^*]+\*\*\s*:?\s*[\d,.]+/.test(lastParagraph)) return false;
    }
  }

  if (lastParagraph.length <= 4) return true;
  return true;
}

const LIGHT_TRUNCATION_PARAGRAPH_MAX = 40;

/** Truncación leve: cumple minChars pero el último párrafo es un fragmento corto sin cierre. */
export function isLightTruncationOnly(section: ReportSection, llmText: string): boolean {
  const body = extractSectionBody(llmText, section.title);
  if (!body || body.length < section.minChars) return false;
  if (!isSectionTextTruncated(body)) return false;

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lastParagraph = paragraphs.at(-1) ?? body;
  return lastParagraph.length < LIGHT_TRUNCATION_PARAGRAPH_MAX;
}

export function sectionAcceptsLightTruncation(section: ReportSection): boolean {
  if (section.kind === "dimension_overview") return true;
  if (section.kind === "custom" && !/síntesis|sintesis/i.test(section.title)) return true;
  return false;
}

export function getSectionRejectionReason(
  section: ReportSection,
  llmText: string
): string {
  const body = extractSectionBody(llmText, section.title);
  if (!body) return "empty_body";
  if (body.length < section.minChars) return `too_short:${body.length}<${section.minChars}`;
  if (isSectionTextTruncated(body)) return "truncated";
  if (
    section.kind === "custom" &&
    /resumen.*proyecto|proyecto.*resumen/i.test(section.title) &&
    /^(nombre del proyecto|objetivo general|objetivos específicos)/im.test(llmText)
  ) {
    return "raw_project_paste";
  }
  return "unknown";
}

export function buildIncompleteSectionRetryUser(
  section: ReportSection,
  sourceMaterial: string
): string {
  return `Tu respuesta anterior quedó INCOMPLETA o demasiado corta. Reescribe la sección COMPLETA desde cero.

Requisitos:
- ${EVALUATION_REPORT_LANGUAGE_BULLET}
- Extensión: ${describeLengthTarget(section)}.
- Texto íntegro: todas las oraciones deben cerrar con punto (nunca cortes a mitad de palabra ni de frase).
- Encabezado ## ${section.title}.
- No cuentes caracteres uno a uno: escribe el texto directamente con la extensión indicada.

Material fuente:
${sourceMaterial.slice(0, 8000)}`;
}

/**
 * Describe la extensión objetivo en términos CUALITATIVOS (párrafos/oraciones)
 * en vez de un rango exacto de caracteres. Los rangos numéricos exactos hacen
 * que algunos modelos de reasoning entren en modo obsesivo contando letra por
 * letra, consumiendo todo su presupuesto de tokens sin llegar a producir texto.
 */
function describeLengthTarget(section: ReportSection): string {
  const avg = Math.round((section.minChars + section.maxChars) / 2);
  const paragraphs = section.kind === "dimension_overview" ? "1–2 párrafos" : "2–4 párrafos";
  return `${paragraphs} de prosa continua (~${avg} caracteres, sin necesidad de contar exactamente)`;
}

function isProjectSummarySection(section: ReportSection): boolean {
  return (
    section.kind === "custom" &&
    /resumen.*proyecto|proyecto.*resumen/i.test(section.title)
  );
}

function isSynthesisCustomSection(section: ReportSection): boolean {
  return section.kind === "custom" && /síntesis|sintesis/i.test(section.title);
}

export function buildSectionFormatSystemPrompt(
  section: ReportSection,
  rubric: RubricConfig
): string {
  if (isProjectSummarySection(section)) {
    return buildProjectSummarySystemPrompt(section);
  }
  if (section.kind === "dimension_overview") {
    return buildDimensionOverviewSystemPrompt(section);
  }
  if (isSynthesisCustomSection(section)) {
    return buildFinalSynthesisSystemPrompt(section);
  }

  const scoresNote =
    rubric.type === "ponderaciones" && section.kind === "subdimension_eval"
      ? "\n- Preserva la línea exacta «Nota: N» del borrador (mismo valor numérico)."
      : "";

  return `Eres un editor de informes de evaluación. Tu tarea es redactar UNA ÚNICA sección del informe final.

SECCIÓN A REDACTAR:
**${section.title}**
Descripción: ${section.description}

EXTENSIÓN:
- ${describeLengthTarget(section)}.
- Si el borrador es demasiado corto, EXPANDE con detalle técnico del análisis sin inventar hechos.
- NO cuentes caracteres uno a uno: escribe con la extensión indicada de forma natural.

REGLAS:
- ${EVALUATION_REPORT_LANGUAGE_BULLET}
- Responde SOLO con el contenido de esta sección (incluye un encabezado ## ${section.title} o equivalente).
- No añadas otras secciones del informe.
- No incluyas anotaciones de límite de caracteres en el texto final.
- Mantén tono profesional y objetivo.${scoresNote}`;
}

function buildProjectSummarySystemPrompt(section: ReportSection): string {
  return `Eres redactor de informes de evaluación. Redacta UNA sección: **${section.title}**.

OBJETIVO: síntesis narrativa del proyecto en prosa continua (1–3 párrafos).

EXTENSIÓN: ${describeLengthTarget(section)}.

REGLAS ESTRICTAS:
- ${EVALUATION_REPORT_LANGUAGE_BULLET}
- NO copies ni listes los campos extraídos del proyecto.
- NO uses etiquetas como «Objetivo General», «Nombre del proyecto», etc.
- NO uses viñetas ni listas numeradas.
- NO cuentes caracteres uno a uno: escribe con la extensión indicada de forma natural.
- Integra la información en un texto fluido que presente qué es el proyecto, su contexto y su propósito.
- Entrega el texto ÍNTEGRO: nunca lo cortes ni lo trunques; cierra cada oración con punto final.
- Responde con encabezado ## ${section.title} y el texto del resumen.`;
}

function buildDimensionOverviewSystemPrompt(section: ReportSection): string {
  return `Eres redactor de informes de evaluación. Redacta UNA sección: **${section.title}**.

OBJETIVO: resumen macro de la dimensión sintetizando las evaluaciones de sus subdimensiones.

EXTENSIÓN: ${describeLengthTarget(section)}.
- PROHIBIDO truncar con puntos suspensivos («…» o «...») a mitad de idea.
- NO cuentes caracteres uno a uno: redacta con naturalidad.

REGLAS:
- ${EVALUATION_REPORT_LANGUAGE_BULLET}
- Sintetiza hallazgos y conclusiones de las subdimensiones; no re-evalúes ni cambies notas.
- Texto en prosa continua (1–2 párrafos), sin viñetas.
- Entrega el texto ÍNTEGRO; nunca lo cortes a mitad de palabra ni de frase.
- Responde con encabezado ## ${section.title} y el resumen.`;
}

export function buildFinalSynthesisSystemPrompt(section: ReportSection): string {
  return `Eres evaluador experto. Redacta la **${section.title}** del informe.

OBJETIVO: conclusión evaluativa global de toda la evaluación (todas las dimensiones).

EXTENSIÓN: ${describeLengthTarget(section)}.
- NO cuentes caracteres uno a uno: redacta con naturalidad la extensión indicada.

REGLAS:
- ${EVALUATION_REPORT_LANGUAGE_BULLET}
- Resume el veredicto evaluativo: fortalezas, debilidades y conclusión.
- Puedes mencionar la nota global del indicador si se proporciona.
- NO describas el proyecto, sus actividades ni beneficiarios en detalle.
- NO uses viñetas ni listas.
- Entrega la síntesis ÍNTEGRA; nunca la cortes a mitad de frase.
- Responde con encabezado ## ${section.title} y el texto de la síntesis.`;
}

export function buildFinalSynthesisSystemPromptForLevels(
  section: ReportSection,
  assignedLevel: number | null,
  levelTitle: string
): string {
  const levelLine =
    assignedLevel != null
      ? `El nivel asignado es ${assignedLevel}${levelTitle ? ` (${levelTitle})` : ""}.`
      : "Incluye el nivel asignado si consta en el material fuente.";

  return `Eres evaluador experto. Redacta la **${section.title}** del informe.

OBJETIVO: conclusión evaluativa global según la escala de niveles (no hay subdimensiones ni notas numéricas).

EXTENSIÓN: ${describeLengthTarget(section)}.
- NO cuentes caracteres uno a uno: redacta con naturalidad la extensión indicada.

REGLAS:
- ${EVALUATION_REPORT_LANGUAGE_BULLET}
- ${levelLine}
- Sintetiza fortalezas, brechas y por qué corresponde ese nivel (no otro adyacente).
- Puedes referirte al emprendimiento o proyecto de forma evaluativa; NO repitas el resumen del proyecto ni listes actividades.
- NO uses viñetas ni listas.
- Entrega la síntesis ÍNTEGRA; nunca la cortes a mitad de frase.
- Responde con encabezado ## ${section.title} y el texto de la síntesis.`;
}

export function buildSynthesisSourceMaterialForLevels(
  rawEvaluation: string,
  assignedLevel: number | null,
  levelTitle: string,
  indicatorLabel: string
): string {
  const lines: string[] = [];
  if (assignedLevel != null) {
    lines.push(
      `Nivel asignado (${indicatorLabel}): ${assignedLevel}${levelTitle ? ` — ${levelTitle}` : ""}`
    );
  }
  lines.push("", "Evaluación completa (análisis, nivel y justificación):", rawEvaluation.trim());
  return lines.join("\n");
}

export function buildSectionFormatUserPrompt(
  section: ReportSection,
  sourceMaterial: string
): string {
  if (isProjectSummarySection(section)) {
    return `A partir de estos datos del proyecto, redacta un resumen narrativo (no copies el listado):

${sourceMaterial}

Responde solo con la sección formateada.`;
  }
  if (section.kind === "dimension_overview") {
    return `Sintetiza en prosa las evaluaciones de subdimensión siguientes:

${sourceMaterial}

Responde solo con la sección formateada.`;
  }
  return `Redacta la sección según las instrucciones del sistema. Material fuente:

${sourceMaterial}

Responde solo con el texto de esta sección formateada.`;
}

export function buildSynthesisSourceMaterial(
  rawEvaluation: string,
  schema: { dimension: string; name: string; key: string }[],
  scores: Record<string, number | null>,
  overallScore: number | null,
  indicatorLabel: string
): string {
  const lines: string[] = ["Notas por subdimensión:"];
  for (const entry of schema) {
    const s = scores[entry.key];
    if (s != null) lines.push(`- ${entry.dimension} / ${entry.name}: ${s}`);
  }
  if (overallScore != null) {
    lines.push("", `Índice ${indicatorLabel} ponderado: ${overallScore}`);
  }
  lines.push("", "Fragmentos evaluativos:");
  for (const entry of schema) {
    const body = extractSubdimensionSection(rawEvaluation, entry.name);
    if (!body?.trim()) continue;
    const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 500);
    lines.push(`\n[${entry.name}] ${excerpt}`);
  }
  return lines.join("\n");
}

export function resolveSectionSource(
  section: ReportSection,
  rubric: RubricConfig,
  rawEvaluation: string,
  projectElementsTable: { element: string; content: string }[]
): string {
  if (section.kind === "custom") {
    if (isProjectSummarySection(section)) {
      if (projectElementsTable.length > 0) {
        return condenseProjectElementsForPrompt(projectElementsTable);
      }
    }
    return rawEvaluation;
  }

  if (section.kind === "assigned_level") {
    const body = extractGlobalLevelSection(rawEvaluation);
    return body ?? rawEvaluation;
  }

  if (rubric.type === "niveles" && section.kind === "variable_eval" && section.variableId) {
    const variable = rubric.variables.find((v) => v.id === section.variableId);
    if (variable) {
      const body = extractVariableSection(rawEvaluation, variable.name);
      if (body) return body;
    }
    return rawEvaluation;
  }

  if (rubric.type !== "ponderaciones") {
    return rawEvaluation;
  }

  if (section.kind === "subdimension_eval" && section.subdimensionId) {
    for (const dim of rubric.dimensions) {
      const sub = dim.subdimensions.find((s) => s.id === section.subdimensionId);
      if (sub) {
        const body = extractSubdimensionSection(rawEvaluation, sub.name);
        if (body) return body;
      }
    }
    return rawEvaluation;
  }

  if (section.kind === "dimension_overview" && section.dimensionId) {
    const dim = rubric.dimensions.find((d) => d.id === section.dimensionId);
    if (dim) {
      const parts: string[] = [];
      for (const sub of dim.subdimensions) {
        const body = extractSubdimensionSection(rawEvaluation, sub.name);
        if (body) parts.push(`### Subdimensión: ${sub.name}\n\n${body}`);
      }
      if (parts.length > 0) return parts.join("\n\n");
    }
    return rawEvaluation;
  }

  return rawEvaluation;
}

/** Convierte sección custom de config en ReportSection para prompts de síntesis. */
export function customSectionToReportSection(sec: ReportCustomSection): ReportSection {
  return {
    id: sec.id,
    title: sec.title,
    description: sec.description,
    minChars: sec.minChars,
    maxChars: sec.maxChars,
    kind: "custom",
  };
}
