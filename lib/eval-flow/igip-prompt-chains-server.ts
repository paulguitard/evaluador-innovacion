import "server-only";

import { getConfig } from "@/lib/db";
import { getEvaluationTypeByIdPostgres } from "@/lib/db-postgres";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import { getEvaluationTypeSettings } from "@/lib/evaluation-type-settings-server";
import { isIgip } from "@/lib/eval-types/constants";
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_EVAL_SYSTEM_FALLBACK,
  DEFAULT_SUBDIMENSION_USER_PROMPT,
} from "@/lib/eval-types/prompt-defaults";
import {
  DEFAULT_GANTT_STRUCTURE_PROMPT_IGIP,
  DEFAULT_INDICATORS_STRUCTURE_PROMPT_IGIP,
} from "@/lib/eval-types/extract-config-defaults";
import {
  mergeRubricConfig,
  subdimensionEvalContent,
  type RubricConfigPonderaciones,
} from "@/lib/rubric-config";
import {
  mergeReportFormatConfig,
  expandReportSections,
  buildFormatSystemPrompt,
  compileReportFormatToLegacyText,
  isReportFormatValid,
} from "@/lib/report-format-config";
import {
  buildSectionFormatSystemPrompt,
  buildFinalSynthesisSystemPrompt,
  customSectionToReportSection,
} from "@/lib/format-report-sections";
import {
  buildEvaluateSystemStructureDoc,
  EVALUATE_SYSTEM_RELATED_CONFIG_ACTIONS,
} from "./evaluate-system-structure-doc";
import { buildEvaluateSystemAssemblyFlow } from "./evaluate-system-assembly-flow";
import {
  buildEvaluateSystemMessageNode,
  buildEvaluateUserMessageNode,
  EVALUATE_LLM_CHAIN_HINT,
  previewUserMessageWithOrientation,
} from "./evaluate-llm-chain-builders";
import {
  FALLBACK_SUMMARY_SYSTEM_PROMPT,
} from "@/lib/system-prompts-catalog";
import {
  buildReportAssemblySequence,
  perSectionLlmRepeatLabel,
} from "./report-assembly-sequence";
import {
  chainNode,
  type IgipFlowPromptChainsResponse,
  type IgipFlowStepPrompts,
  type IgipPromptChain,
} from "./igip-prompt-chains-types";

function buildIgipEvaluateAssemblyFlow(
  rubric: RubricConfigPonderaciones,
  evaluation: Awaited<ReturnType<typeof getEvaluationConfig>>,
  elementsList: { title?: string; description?: string; section?: string }[],
  reportFormat: ReturnType<typeof mergeReportFormatConfig>
) {
  const dim = rubric.dimensions[0];
  const sub = dim?.subdimensions[0];
  const focusSnippet =
    dim && sub
      ? subdimensionEvalContent(dim, sub)
      : "[Criterios de la subdimensión activa en runtime]";
  const reportFormatPreview = isReportFormatValid(reportFormat, rubric)
    ? compileReportFormatToLegacyText(reportFormat, rubric)
    : undefined;

  return buildEvaluateSystemAssemblyFlow({
    focusLabel: "subdimensión",
    focusTitle: sub?.name ?? "[subdimensión activa]",
    dimensionTitle: dim?.name,
    focusSnippet,
    elementsList,
    rubric,
    evaluation,
    reportFormatPreview,
  });
}

function buildEvaluateSystemPreview(
  rubric: RubricConfigPonderaciones,
  evaluation: Awaited<ReturnType<typeof getEvaluationConfig>>
): string {
  const dim = rubric.dimensions[0];
  const sub = dim?.subdimensions[0];
  const focusSnippet =
    dim && sub
      ? subdimensionEvalContent(dim, sub)
      : "[Criterios de la subdimensión activa en runtime]";
  return buildEvaluateSystemStructureDoc({
    focusLabel: "subdimensión",
    focusSnippet,
    knowledgeLabel: evaluation.knowledgeReferenceLabel,
    projectElementsInRagQuery: evaluation.projectElementsInRagQuery,
    ragEvaluate: evaluation.ragEvaluate,
  });
}

export async function buildIgipFlowPromptChains(
  evaluationTypeId: number
): Promise<IgipFlowPromptChainsResponse | null> {
  const typeRow = await getEvaluationTypeByIdPostgres(evaluationTypeId);
  if (!typeRow || !isIgip(typeRow.name)) return null;

  const [config, typeSettings, evaluation] = await Promise.all([
    getConfig(evaluationTypeId),
    getEvaluationTypeSettings(evaluationTypeId),
    getEvaluationConfig(evaluationTypeId),
  ]);

  const rubric = mergeRubricConfig(
    config ? JSON.parse(config.rubric_config || "{}") : undefined,
    "IGIP"
  ) as RubricConfigPonderaciones;
  const reportFormat = mergeReportFormatConfig(
    config ? JSON.parse(config.report_format_config || "{}") : undefined,
    rubric
  );
  const extract = typeSettings.extract;
  const elementCount = (() => {
    if (!config?.elements) return 0;
    try {
      const parsed = JSON.parse(config.elements);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  })();
  const subdimCount = rubric.dimensions.reduce((n, d) => n + d.subdimensions.length, 0);

  let elementsList: { title?: string; description?: string; section?: string }[] = [];
  if (config?.elements) {
    try {
      const parsed = JSON.parse(config.elements);
      elementsList = Array.isArray(parsed) ? parsed : [];
    } catch {
      elementsList = [];
    }
  }

  const evaluateAssemblyFlow = buildIgipEvaluateAssemblyFlow(
    rubric,
    evaluation,
    elementsList,
    reportFormat
  );

  const extractSystem =
    extract.prompts?.system?.trim() || DEFAULT_EXTRACT_SYSTEM_PROMPT;
  const agentTemplate =
    extract.agent?.userPromptTemplate?.trim() ||
    `Elemento a extraer: "{{title}}"
Sección: {{section}}
Descripción de qué buscar: {{description}}{{extraHints}}

Usa las herramientas para buscar en todo el proyecto. Cuando tengas suficiente información, responde con JSON {"content":"...","confidence":"high|medium|low"}.`;

  const extractChains: IgipPromptChain[] = [
    {
      id: "extract-per-element",
      title: "Llamada LLM por elemento",
      repeatLabel: elementCount > 0 ? `× ${elementCount} elementos` : "× N elementos",
      nodes: [
        chainNode(
          1,
          "system",
          "System — agente de extracción",
          "Rol del agente al buscar cada elemento en el proyecto.",
          extractSystem,
          extract.prompts?.system?.trim() ? "configuración" : "código",
          "extract-basic"
        ),
        chainNode(
          2,
          "user",
          "User — elemento a extraer",
          "Título, sección y descripción del elemento configurado.",
          agentTemplate,
          extract.agent?.userPromptTemplate?.trim() ? "configuración" : "código",
          "extract-advanced"
        ),
        chainNode(
          3,
          "tools",
          "Bucle tool-calling",
          `Hasta ${extract.agent?.maxToolIterations ?? 5} iteraciones: search_project, get_structured_excel, get_document_pages…`,
          "El asistente puede invocar herramientas; cada resultado vuelve como mensaje tool antes de la respuesta JSON final.",
          "código",
          "extract-advanced"
        ),
      ],
    },
    {
      id: "extract-structure",
      title: "Formateo estructurado (si aplica)",
      repeatLabel: "Condicional por hoja Excel",
      nodes: [
        chainNode(
          1,
          "system",
          "System — carta Gantt",
          "Cuando se detecta hoja Gantt/Cronograma.",
          (extract.structurePrompts.gantt?.trim() || DEFAULT_GANTT_STRUCTURE_PROMPT_IGIP) +
            "\n\n[En runtime se añade la descripción del elemento.]",
          extract.structurePrompts.gantt?.trim() ? "configuración" : "código",
          "extract-basic"
        ),
        chainNode(
          2,
          "system",
          "System — indicadores",
          "Cuando se detecta hoja de indicadores.",
          extract.structurePrompts.indicators?.trim() || DEFAULT_INDICATORS_STRUCTURE_PROMPT_IGIP,
          extract.structurePrompts.indicators?.trim() ? "configuración" : "código",
          "extract-basic"
        ),
      ],
    },
  ];

  const knowledgeChains: IgipPromptChain[] = [
    {
      id: "knowledge-rag",
      title: "Índice RAG (sin LLM directo)",
      nodes: [
        chainNode(
          1,
          "context",
          "Documentos de referencia",
          "PDF, Word, Excel indexados como knowledge del tipo IGIP.",
          "Los archivos configurados se trocean según chunk/overlap de RAG y alimentan la búsqueda semántica en evaluación.",
          "configuración",
          "knowledge-docs"
        ),
        chainNode(
          2,
          "context",
          "Fragmentos recuperados",
          `topK y límites de caracteres en modo evaluate.`,
          `RAG evaluate: topK=${evaluation.ragEvaluate.topK ?? "default"}, maxRetrievedChars=${evaluation.ragEvaluate.maxRetrievedChars ?? "default"}, maxSystemChars=${evaluation.ragEvaluate.maxSystemChars ?? "default"}.`,
          "configuración",
          "eval-rag"
        ),
        chainNode(
          3,
          "output",
          "Destino en el pipeline",
          "Los fragmentos se insertan en buildSystemContext del paso 4.",
          "No hay llamada LLM en este paso; el knowledge se consulta al evaluar cada subdimensión.",
          "dinámico"
        ),
      ],
    },
  ];

  const rubricChains: IgipPromptChain[] = [
    {
      id: "rubric-input",
      title: "Datos de rúbrica (sin LLM)",
      nodes: [
        chainNode(
          1,
          "context",
          "Dimensiones y subdimensiones",
          "Criterios, ponderaciones y escala 1–4.",
          rubric.dimensions
            .map(
              (d) =>
                `## ${d.name}\n${d.subdimensions.map((s) => `- ${s.name} (${s.weightPercent}%)`).join("\n")}`
            )
            .join("\n\n") || "(sin dimensiones configuradas)",
          "configuración",
          "rubric"
        ),
        chainNode(
          2,
          "output",
          "Uso en evaluación",
          "Se inyecta en system (enfoque parcial) y en plantilla user (scoreExamples).",
          "La rúbrica no llama al LLM por sí sola; estructura qué evaluar en el paso 4.",
          "dinámico"
        ),
      ],
    },
  ];

  const evaluateChains: IgipPromptChain[] = [
    {
      id: "eval-per-subdim",
      title: "Evaluación RAG + LLM",
      repeatLabel: subdimCount > 0 ? `× ${subdimCount} subdimensiones` : "× N subdimensiones",
      hint: EVALUATE_LLM_CHAIN_HINT,
      nodes: [
        buildEvaluateSystemMessageNode({
          order: 1,
          systemPreview: buildEvaluateSystemPreview(rubric, evaluation),
          assemblyFlow: evaluateAssemblyFlow,
          relatedConfigActionIds: EVALUATE_SYSTEM_RELATED_CONFIG_ACTIONS,
        }),
        buildEvaluateUserMessageNode({
          order: 2,
          focusLabel: "subdimensión",
          template:
            evaluation.prompts.subdimensionUser?.trim() || DEFAULT_SUBDIMENSION_USER_PROMPT,
          templateSource: evaluation.prompts.subdimensionUser?.trim() ? "configuración" : "código",
          orientation: evaluation.phaseInstructions.subdimensionEval?.trim() ?? "",
          userPreview: previewUserMessageWithOrientation(
            evaluation.prompts.subdimensionUser?.trim() || DEFAULT_SUBDIMENSION_USER_PROMPT,
            evaluation.phaseInstructions.subdimensionEval?.trim() ?? "",
            {
              dimension: "[dimensión activa]",
              subdimension: "[subdimensión activa]",
              scoreExamples: "[escala de notas]",
              knowledgeLabel: evaluation.knowledgeReferenceLabel,
            }
          ),
        }),
        chainNode(
          3,
          "output",
          "Respuesta esperada",
          "Análisis, Nota, Justificación, Mejoras.",
          "El texto se concatena en rawEvaluation (borrador) antes del formateo del informe.",
          "dinámico"
        ),
      ],
    },
    {
      id: "eval-scores-json",
      title: "JSON de notas (determinista)",
      repeatLabel: "Tras evaluar todas las subdimensiones",
      hint:
        "Sin LLM: al cerrar el paso 4 se parsea «Nota: N» de cada subdimensión, se calcula el índice ponderado y se emite un JSON autoritativo. Ese JSON alimenta el bloque de notas del paso 6.",
      nodes: [
        chainNode(
          1,
          "output",
          "evaluation_scores",
          "Payload JSON con subdimensionScores, filas tabulares e overallScore (2 decimales).",
          `Ejemplo de estructura emitida:
{
  "indicatorLabel": "IGIP",
  "subdimensionScores": { "Novedad / Grado de Originalidad…": 3, … },
  "rows": [{ "subdimension": "…", "score": 3, "weight": 25 }, …],
  "overallScore": 2.85
}

Fuente: parseSubdimensionScore() en cada análisis del paso 4 + computeWeightedIndicatorScore().`,
          "dinámico"
        ),
      ],
    },
  ];

  const sections = expandReportSections(rubric, reportFormat);
  const perSectionLlmSections = sections.filter(
    (s) => s.kind === "dimension_overview" || (s.kind === "custom" && !/síntesis|sintesis/i.test(s.title))
  );
  const exampleSection =
    perSectionLlmSections.find((s) => s.kind === "dimension_overview") ?? perSectionLlmSections[0];
  const synthesisSection =
    reportFormat.beforeScores?.find((s) => /síntesis|sintesis/i.test(s.title)) ?? null;
  const assemblySequence = buildReportAssemblySequence(rubric, reportFormat);

  const formatExtra = [evaluation.prompts.formatSystem, evaluation.prompts.formatInstructions]
    .filter(Boolean)
    .join("\n\n");

  const reportChains: IgipPromptChain[] = [
    {
      id: "report-per-section",
      title: "Formateo LLM por sección",
      repeatLabel: perSectionLlmRepeatLabel(rubric, reportFormat),
      hint:
        "Se ejecuta en el orden del informe para el resumen inicial y cada «Dimensión: …». No incluye la síntesis final ni las evaluaciones de subdimensión (esas van en cadenas aparte, intercaladas según la secuencia de abajo).",
      nodes: [
        chainNode(
          1,
          "system",
          "System — plantilla de sección",
          "Generada desde formato de informe + rúbrica; puede llevar overrides.",
          exampleSection
            ? buildSectionFormatSystemPrompt(exampleSection, rubric) +
                (formatExtra ? `\n\n--- Overrides ---\n${formatExtra}` : "")
            : buildFormatSystemPrompt(reportFormat, rubric),
          "dinámico",
          "report-prompts"
        ),
        chainNode(
          2,
          "user",
          "User — borrador + instrucciones",
          "Fragmento del borrador y límites min/max de la sección.",
          exampleSection
            ? `Sección: ${exampleSection.title}\nLímites: ${exampleSection.minChars}–${exampleSection.maxChars} caracteres.\n\n[Extracto del borrador de evaluación correspondiente a esta sección]`
            : "[Instrucciones y extracto del borrador por sección]",
          "dinámico",
          "report-structure"
        ),
      ],
    },
    {
      id: "report-subdim-verbatim",
      title: "Evaluaciones de subdimensión",
      repeatLabel: "Sin LLM — copia literal",
      hint:
        "Tras cada resumen de dimensión, se insertan sus subdimensiones en el mismo orden del informe, copiando el texto del paso 4 sin reformatear.",
      nodes: [
        chainNode(
          1,
          "context",
          "subdimension_eval",
          "Las secciones de evaluación por subdimensión no se reformatean.",
          "El texto del borrador (paso 4) se inserta verbatim en el informe final.",
          "dinámico",
          "report-structure"
        ),
      ],
    },
    {
      id: "report-synthesis",
      title: "Síntesis evaluativa final",
      hint:
        "Última sección del informe (antes del paso 6). Prompt distinto al formateo por sección: recibe notas, extractos y el informe parcial ya ensamblado.",
      nodes: [
        chainNode(
          1,
          "system",
          "System — síntesis",
          synthesisSection
            ? `Plantilla para «${synthesisSection.title}».`
            : "Fallback si no hay sección de síntesis en formato.",
          synthesisSection
            ? buildFinalSynthesisSystemPrompt(customSectionToReportSection(synthesisSection))
            : FALLBACK_SUMMARY_SYSTEM_PROMPT(evaluation.indicatorLabel),
          "dinámico",
          "report-structure"
        ),
        chainNode(
          2,
          "user",
          "User — material de síntesis",
          "Resumen de notas y extractos del informe parcial.",
          "[evaluationSummary input: borrador + secciones ya formateadas + notas]",
          "dinámico"
        ),
      ],
    },
  ];

  const scoresChains: IgipPromptChain[] = [
    {
      id: "scores-inject",
      title: "Notas e índice IGIP",
      hint:
        "Sin LLM: se renderiza una tabla Markdown desde el JSON de notas del paso 4 y se inserta al cierre del informe. Si el LLM de formateo generó un bloque de notas erróneo al final, se sustituye.",
      nodes: [
        chainNode(
          1,
          "output",
          "Bloque autoritativo",
          "Tabla Subdimensión | Nota + índice con 2 decimales.",
          `Se genera desde buildAuthoritativeScoresSection() usando el JSON evaluation_scores (sin segunda extracción LLM).

| Subdimensión | Nota |
| --- | --- |
| … | 3 |

**Índice IGIP**: 2.85`,
          "dinámico"
        ),
      ],
    },
  ];

  const steps: IgipFlowStepPrompts[] = [
    { stepId: "extract", chains: extractChains },
    { stepId: "knowledge", chains: knowledgeChains },
    { stepId: "rubric", chains: rubricChains },
    { stepId: "evaluate", chains: evaluateChains },
    { stepId: "report", chains: reportChains, assemblySequence },
    { stepId: "scores", chains: scoresChains },
  ];

  return {
    generatedAt: new Date().toISOString(),
    evaluationTypeId,
    steps,
  };
}