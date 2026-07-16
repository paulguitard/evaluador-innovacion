import type { FlowConfigActionId } from "./igip-flow-definition";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import { compileRubricToLegacyText } from "@/lib/rubric-config";
import type { SystemPromptSource } from "@/lib/system-prompts-catalog";
import {
  EVALUATION_RESPONSE_LANGUAGE_RULE,
  EVALUATION_SYSTEM_SUFFIX,
} from "@/lib/system-prompts-catalog";

export type AssemblyStepGroup = "message" | "buildSystemContext" | "postAssembly" | "conditional";
export type AssemblyStepKind = "text" | "process" | "validation";

export type EvaluateSystemAssemblyStep = {
  id: string;
  order: number;
  group: AssemblyStepGroup;
  /** Parte N del mensaje SYSTEM final (solo bloques de texto incluidos). */
  assemblyPart?: number;
  /** Encabezado markdown que inicia este bloque en el texto ensamblado. */
  heading?: string;
  stepKind: AssemblyStepKind;
  title: string;
  description: string;
  contentPreview: string;
  fullContent: string;
  source: SystemPromptSource;
  /** Si false, no se incluye en modo evaluate (se muestra como omitido). */
  included: boolean;
  omitReason?: string;
  /** Solo aplica si el contexto ensamblado queda vacío. */
  conditional?: boolean;
  configActionIds: FlowConfigActionId[];
  codeReference?: string;
};

export type EvaluateSystemAssemblyFlow = {
  focusLabel: string;
  steps: EvaluateSystemAssemblyStep[];
};

const METHODOLOGY_PIPELINE_TEXT =
  "Programada en la aplicación: extraer elementos del proyecto → evaluar por dimensión/subdimensión según rúbrica → fundamentar con Knowledge → generar informe según formato configurado.";

const CONFIG_SUMMARY_RULE =
  "REGLA: Si el usuario pregunta por la configuración, el formato del informe o los elementos a identificar, responde ÚNICAMENTE con lo indicado en esta sección. No confundas rúbrica con formato. No inventes pasos ni criterios a partir del manual de referencia.";

type ElementRow = { title?: string; description?: string; section?: string };

function formatElementsConfigText(elementsList: ElementRow[]): string {
  const bySection = elementsList.reduce(
    (acc, el) => {
      const section = (el.section ?? "General").trim() || "General";
      if (!acc[section]) acc[section] = [];
      acc[section].push({
        title: el.title ?? "",
        description: el.description ?? "",
      });
      return acc;
    },
    {} as Record<string, { title: string; description: string }[]>
  );

  if (Object.keys(bySection).length === 0) return "Ninguno configurado.";

  return Object.entries(bySection)
    .map(
      ([sec, items]) =>
        `**${sec}:**\n` +
        items
          .map((e) => `- ${e.title || "(sin nombre)"}${e.description ? `: ${e.description}` : ""}`)
          .join("\n")
    )
    .join("\n\n");
}

/** Réplica de configSummary en build-context.ts para modo evaluate (sin rúbrica ni formato de informe). */
export function buildEvaluateConfigSummaryText(params: {
  elementsList: ElementRow[];
  indicatorLabel: string;
  knowledgeLabel: string;
}): string {
  const elementsConfigText = formatElementsConfigText(params.elementsList);
  return [
    "**Metodología de evaluación:**",
    METHODOLOGY_PIPELINE_TEXT,
    "",
    "**Elementos a identificar en el proyecto** (lo que se extrae y se muestra en 'Proyecto extraído'):",
    elementsConfigText,
    "",
    `**Parámetros de evaluación (§5):** índice ${params.indicatorLabel}, knowledge «${params.knowledgeLabel}».`,
    "",
    CONFIG_SUMMARY_RULE,
  ].join("\n");
}

function formatRagParams(ragEvaluate: EvaluationConfig["ragEvaluate"]): string {
  const parts: string[] = [];
  parts.push(ragEvaluate.topK != null ? `topK=${ragEvaluate.topK}` : "topK=default");
  parts.push(
    ragEvaluate.maxRetrievedChars != null
      ? `maxRetrievedChars=${ragEvaluate.maxRetrievedChars}`
      : "maxRetrievedChars=default"
  );
  parts.push(
    ragEvaluate.maxSystemChars != null
      ? `maxSystemChars=${ragEvaluate.maxSystemChars}`
      : "maxSystemChars=default"
  );
  return parts.join(", ");
}

export type BuildEvaluateSystemAssemblyFlowParams = {
  focusLabel: string;
  focusTitle: string;
  dimensionTitle?: string;
  focusSnippet: string;
  elementsList: ElementRow[];
  rubric: RubricConfig;
  evaluation: EvaluationConfig;
  reportFormatPreview?: string;
};

export function buildEvaluateSystemAssemblyFlow(
  params: BuildEvaluateSystemAssemblyFlowParams
): EvaluateSystemAssemblyFlow {
  const { evaluation, rubric, focusLabel, focusTitle, dimensionTitle, focusSnippet } = params;
  const rubricText = compileRubricToLegacyText(rubric).trim();
  const configSummary = buildEvaluateConfigSummaryText({
    elementsList: params.elementsList,
    indicatorLabel: evaluation.indicatorLabel,
    knowledgeLabel: evaluation.knowledgeReferenceLabel,
  });
  const ragParams = formatRagParams(evaluation.ragEvaluate);
  const elementNames = params.elementsList
    .map((e) => e.title?.trim())
    .filter(Boolean) as string[];

  const focusFull = dimensionTitle
    ? `## Enfoque de esta evaluación parcial\n\nEvalúa ÚNICAMENTE la ${focusLabel} **${focusTitle}** (dimensión **${dimensionTitle}**). Fundamenta el análisis en los fragmentos de **${evaluation.knowledgeReferenceLabel}** (Knowledge) incluidos abajo y en los datos del proyecto.\n\n### Criterios de esta ${focusLabel}\n\n${focusSnippet}`
    : `## Enfoque de esta evaluación parcial\n\nEvalúa ÚNICAMENTE la ${focusLabel} **${focusTitle}**. Fundamenta el análisis en los fragmentos de **${evaluation.knowledgeReferenceLabel}** (Knowledge) incluidos abajo y en los datos del proyecto.\n\n### Criterios\n\n${focusSnippet}`;

  const projectPreview =
    elementNames.length > 0
      ? `[En runtime: tabla element/content tras la extracción]\n\nElementos configurados que alimentan esta sección (${elementNames.length}):\n${elementNames.map((n) => `- ${n}`).join("\n")}`
      : "[En runtime: tabla element/content tras la extracción]\n\nNo hay elementos configurados en «Elementos a identificar».";

  const knowledgePreview = `## Documentación de referencia (Knowledge)

[Fragmentos recuperados en runtime con búsqueda híbrida]

Query: ${focusLabel} activa + hasta ${evaluation.projectElementsInRagQuery} elementos del proyecto en la query.
Parámetros: ${ragParams}
Etiqueta: «${evaluation.knowledgeReferenceLabel}»

REGLA: Fundamenta tu respuesta en estos fragmentos del manual de referencia cuando sea pertinente.`;

  const rubricFull = rubricText
    ? `## Rúbrica y criterios de evaluación\n\n${rubricText}`
    : `## Rúbrica y criterios de evaluación\n\nNo hay rúbrica de evaluación configurada para este tipo de evaluación.`;

  const steps: EvaluateSystemAssemblyStep[] = [
    {
      id: "language-rule",
      order: 1,
      group: "message",
      assemblyPart: 1,
      stepKind: "text",
      title: "Regla de idioma (español 100%)",
      description: "Bloque de texto fijo que inicia el mensaje SYSTEM.",
      contentPreview: EVALUATION_RESPONSE_LANGUAGE_RULE.slice(0, 200) + "…",
      fullContent: EVALUATION_RESPONSE_LANGUAGE_RULE,
      source: "código",
      included: true,
      configActionIds: [],
      codeReference: "lib/evaluate-system-context-strict.ts → buildStrictEvaluationSystemMessage",
    },
    {
      id: "config-summary",
      order: 2,
      group: "buildSystemContext",
      assemblyPart: 2,
      heading: "## Configuración actual de este tipo de evaluación",
      stepKind: "text",
      title: "Metodología y parámetros del tipo",
      description:
        "Metodología del pipeline, lista de elementos a extraer, índice y etiqueta Knowledge.",
      contentPreview: configSummary.slice(0, 280) + (configSummary.length > 280 ? "…" : ""),
      fullContent: `## Configuración actual de este tipo de evaluación\n\n${configSummary}`,
      source: "dinámico",
      included: true,
      configActionIds: ["eval-general", "elements-list"],
      codeReference: "lib/build-context.ts → configSummary (modo evaluate)",
    },
    {
      id: "focus-partial",
      order: 3,
      group: "buildSystemContext",
      assemblyPart: 3,
      heading: "## Enfoque de esta evaluación parcial",
      stepKind: "text",
      title: `Criterios de la ${focusLabel} activa`,
      description: `Texto del criterio en evaluación ahora (${focusLabel} y dimensión en runtime). Instrucción de enfoque + descripciones de nota/nivel de ese criterio.`,
      contentPreview: focusSnippet.slice(0, 280) + (focusSnippet.length > 280 ? "…" : ""),
      fullContent: focusFull,
      source: "dinámico",
      included: true,
      configActionIds: ["rubric"],
      codeReference: "lib/build-context.ts → evaluateSubdimension",
    },
    {
      id: "report-format",
      order: 4,
      group: "buildSystemContext",
      heading: "## Formato del informe",
      stepKind: "text",
      title: "Formato del informe",
      description: "Bloque de formato compilado del informe final.",
      contentPreview: params.reportFormatPreview?.slice(0, 200) ?? "(formato configurado)",
      fullContent: params.reportFormatPreview
        ? `## Formato del informe\n\n${params.reportFormatPreview}`
        : "## Formato del informe\n\n(vacío o no configurado)",
      source: "configuración",
      included: false,
      omitReason: "excludeReportFormat: true — no se concatena al evaluar subdimensiones.",
      configActionIds: ["report-structure"],
      codeReference: "lib/build-context.ts",
    },
    {
      id: "project-elements",
      order: 5,
      group: "buildSystemContext",
      assemblyPart: 4,
      heading: "## Documentos del proyecto a evaluar (elementos identificados)",
      stepKind: "text",
      title: "Elementos extraídos del proyecto",
      description: "Contenido extraído de cada elemento (título + texto) tras el paso de extracción.",
      contentPreview: projectPreview.slice(0, 280) + (projectPreview.length > 280 ? "…" : ""),
      fullContent: `## Documentos del proyecto a evaluar (elementos identificados)\n\n${projectPreview}`,
      source: "dinámico",
      included: true,
      configActionIds: ["elements-list", "extract-basic"],
      codeReference: "lib/build-context.ts → projectElementsTable",
    },
    {
      id: "knowledge-rag",
      order: 6,
      group: "buildSystemContext",
      assemblyPart: 5,
      heading: "## Documentación de referencia (Knowledge)",
      stepKind: "text",
      title: "Fragmentos Knowledge (RAG)",
      description:
        "Fragmentos recuperados por búsqueda híbrida en runtime (query = criterio activo + elementos del proyecto).",
      contentPreview: knowledgePreview.slice(0, 280) + "…",
      fullContent: `${knowledgePreview}

── Parámetros de recuperación (Configuración → RAG en evaluación) ──
• topK = ${evaluation.ragEvaluate.topK ?? "55 (defecto evaluate)"}
• maxRetrievedChars = ${evaluation.ragEvaluate.maxRetrievedChars ?? "48.000 (defecto evaluate)"}`,
      source: "dinámico",
      included: true,
      configActionIds: ["eval-rag", "knowledge-docs"],
      codeReference: "lib/rag-retrieve.ts → retrieveRelevantChunks",
    },
    {
      id: "rubric-full",
      order: 7,
      group: "buildSystemContext",
      assemblyPart: 6,
      heading: "## Rúbrica y criterios de evaluación",
      stepKind: "text",
      title: "Rúbrica completa",
      description: "Texto compilado de todas las dimensiones y subdimensiones (o variables y niveles en IMET).",
      contentPreview: rubricText.slice(0, 280) + (rubricText.length > 280 ? "…" : ""),
      fullContent: rubricFull,
      source: "configuración",
      included: true,
      configActionIds: ["rubric"],
      codeReference: "lib/build-context.ts → compileRubricToLegacyText",
    },
    {
      id: "context-trim",
      order: 8,
      group: "postAssembly",
      stepKind: "process",
      title: "Comprobación de System max chars",
      description:
        "Tras unir las partes 2–6 con separadores ---, se valida el tope maxSystemChars. En evaluate estricto: error si supera (sin truncar).",
      contentPreview: `System max chars = ${evaluation.ragEvaluate.maxSystemChars ?? "110.000 (defecto evaluate)"}`,
      fullContent: `Este paso NO añade texto al mensaje SYSTEM.

Comprueba que la concatenación de las partes 2–6 no supere maxSystemChars (${evaluation.ragEvaluate.maxSystemChars ?? "110.000 (defecto evaluate)"}).

Si supera el límite → EvaluateSystemContextError (evaluación abortada).`,
      source: "dinámico",
      included: true,
      configActionIds: ["eval-rag"],
      codeReference: "lib/build-context.ts → maxSystemChars",
    },
    {
      id: "context-error",
      order: 9,
      group: "conditional",
      stepKind: "validation",
      title: "Validación de secciones obligatorias",
      description:
        "Comprueba que las 5 secciones ## del contexto existen y tienen contenido. Reintento RAG si falla. No añade texto.",
      contentPreview: "EvaluateSystemContextError si falta alguna sección",
      fullContent: `Este paso NO añade texto al mensaje SYSTEM.

Secciones obligatorias validadas:
1. Configuración actual
2. Enfoque de esta evaluación parcial
3. Documentos del proyecto
4. Documentación de referencia (Knowledge)
5. Rúbrica y criterios de evaluación

Si tras reintento RAG sigue incompleto → error explícito (sin fallback).`,
      source: "código",
      included: true,
      conditional: true,
      configActionIds: ["eval-rag", "elements-list", "knowledge-docs", "rubric"],
      codeReference: "lib/evaluate-system-context-strict.ts → validateEvaluateSystemContext",
    },
    {
      id: "suffix",
      order: 10,
      group: "message",
      assemblyPart: 7,
      stepKind: "text",
      title: "Sufijo anti-thinking",
      description: "Bloque de texto fijo que cierra el mensaje SYSTEM.",
      contentPreview: EVALUATION_SYSTEM_SUFFIX.trim(),
      fullContent: EVALUATION_SYSTEM_SUFFIX.trim(),
      source: "código",
      included: true,
      configActionIds: [],
      codeReference: "lib/evaluate-system-context-strict.ts → buildStrictEvaluationSystemMessage",
    },
  ];

  return { focusLabel, steps };
}
