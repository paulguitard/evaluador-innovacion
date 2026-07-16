import "server-only";

import { getConfig } from "@/lib/db";
import { getEvaluationTypeByIdPostgres } from "@/lib/db-postgres";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import { getEvaluationTypeSettings } from "@/lib/evaluation-type-settings-server";
import { isImet } from "@/lib/eval-types/constants";
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET,
  DEFAULT_EVAL_SYSTEM_FALLBACK,
  DEFAULT_ASSIGN_LEVEL_USER_PROMPT,
  DEFAULT_GLOBAL_LEVEL_USER_PROMPT,
  DEFAULT_VARIABLE_EVAL_USER_PROMPT,
} from "@/lib/eval-types/prompt-defaults";
import {
  DEFAULT_GANTT_STRUCTURE_PROMPT_IMET,
  DEFAULT_INDICATORS_STRUCTURE_PROMPT_IMET,
} from "@/lib/eval-types/extract-config-defaults";
import { mergeRubricConfig, type RubricConfigNiveles } from "@/lib/rubric-config";
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
import { variableEvalContent, mainLevelsRubricText } from "@/lib/rubric-niveles";
import {
  buildEvaluateSystemStructureDoc,
  EVALUATE_SYSTEM_RELATED_CONFIG_ACTIONS,
} from "./evaluate-system-structure-doc";
import { buildEvaluateSystemAssemblyFlow } from "./evaluate-system-assembly-flow";
import {
  buildEvaluateSystemMessageNode,
  buildEvaluateUserMessageNode,
  buildLlmUserMessageNode,
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

function buildImetEvaluateAssemblyFlow(
  rubric: RubricConfigNiveles,
  evaluation: Awaited<ReturnType<typeof getEvaluationConfig>>,
  elementsList: { title?: string; description?: string; section?: string }[],
  reportFormat: ReturnType<typeof mergeReportFormatConfig>
) {
  const variable = rubric.variables[0];
  const focusSnippet = variable
    ? variableEvalContent(variable)
    : "[Criterios de la variable activa en runtime]";
  const reportFormatPreview = isReportFormatValid(reportFormat, rubric)
    ? compileReportFormatToLegacyText(reportFormat, rubric)
    : undefined;

  return buildEvaluateSystemAssemblyFlow({
    focusLabel: "variable",
    focusTitle: variable?.name ?? "[variable activa]",
    focusSnippet,
    elementsList,
    rubric,
    evaluation,
    reportFormatPreview,
  });
}

function buildVariableEvalSystemPreview(
  rubric: RubricConfigNiveles,
  evaluation: Awaited<ReturnType<typeof getEvaluationConfig>>
): string {
  const variable = rubric.variables[0];
  const focusSnippet = variable
    ? variableEvalContent(variable)
    : "[Criterios de la variable activa en runtime]";
  return buildEvaluateSystemStructureDoc({
    focusLabel: "variable",
    focusSnippet,
    knowledgeLabel: evaluation.knowledgeReferenceLabel,
    projectElementsInRagQuery: evaluation.projectElementsInRagQuery,
    ragEvaluate: evaluation.ragEvaluate,
  });
}

export async function buildImetFlowPromptChains(
  evaluationTypeId: number
): Promise<IgipFlowPromptChainsResponse | null> {
  const typeRow = await getEvaluationTypeByIdPostgres(evaluationTypeId);
  if (!typeRow || !isImet(typeRow.name)) return null;

  const [config, typeSettings, evaluation] = await Promise.all([
    getConfig(evaluationTypeId),
    getEvaluationTypeSettings(evaluationTypeId),
    getEvaluationConfig(evaluationTypeId),
  ]);

  const rubric = mergeRubricConfig(
    config ? JSON.parse(config.rubric_config || "{}") : undefined,
    "IMET"
  ) as RubricConfigNiveles;
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
  const variableCount = rubric.variables.length;
  const hasVariables = variableCount > 0;

  let elementsList: { title?: string; description?: string; section?: string }[] = [];
  if (config?.elements) {
    try {
      const parsed = JSON.parse(config.elements);
      elementsList = Array.isArray(parsed) ? parsed : [];
    } catch {
      elementsList = [];
    }
  }

  const evaluateAssemblyFlow = buildImetEvaluateAssemblyFlow(
    rubric,
    evaluation,
    elementsList,
    reportFormat
  );

  const extractSystem = extract.prompts?.system?.trim() || DEFAULT_EXTRACT_SYSTEM_PROMPT_IMET;
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
          "Rol del agente al buscar cada elemento en el formulario IMET.",
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
          "Cuando se detecta hoja de actividades.",
          (extract.structurePrompts.gantt?.trim() || DEFAULT_GANTT_STRUCTURE_PROMPT_IMET) +
            "\n\n[En runtime se añade la descripción del elemento.]",
          extract.structurePrompts.gantt?.trim() ? "configuración" : "código",
          "extract-basic"
        ),
        chainNode(
          2,
          "system",
          "System — indicadores",
          "Cuando se detecta hoja de indicadores.",
          extract.structurePrompts.indicators?.trim() || DEFAULT_INDICATORS_STRUCTURE_PROMPT_IMET,
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
          "PDF, Word, Excel indexados como knowledge del tipo IMET.",
          "Los archivos configurados se trocean según chunk/overlap de RAG y alimentan la búsqueda semántica en evaluación.",
          "configuración",
          "knowledge-docs"
        ),
        chainNode(
          2,
          "context",
          "Fragmentos recuperados",
          "topK y límites de caracteres en modo evaluate.",
          `RAG evaluate: topK=${evaluation.ragEvaluate.topK ?? "default"}, maxRetrievedChars=${evaluation.ragEvaluate.maxRetrievedChars ?? "default"}, maxSystemChars=${evaluation.ragEvaluate.maxSystemChars ?? "default"}.`,
          "configuración",
          "eval-rag"
        ),
        chainNode(
          3,
          "output",
          "Destino en el pipeline",
          "Los fragmentos se insertan en buildSystemContext del paso 4.",
          "No hay llamada LLM en este paso; el knowledge se consulta al evaluar cada variable o el nivel global.",
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
          "Variables y niveles",
          "Criterios por variable y escala global de niveles.",
          [
            rubric.variables.length > 0
              ? `Variables:\n${rubric.variables.map((v) => `- ${v.name}`).join("\n")}`
              : "(sin variables configuradas)",
            rubric.levels.length > 0
              ? `\nNiveles globales:\n${mainLevelsRubricText(rubric.levels)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n") || "(rúbrica vacía)",
          "configuración",
          "rubric"
        ),
        chainNode(
          2,
          "output",
          "Uso en evaluación",
          "Se inyecta en system (enfoque parcial) y en plantillas user de variable/nivel.",
          "La rúbrica no llama al LLM por sí sola; estructura qué evaluar en el paso 4.",
          "dinámico"
        ),
      ],
    },
  ];

  const evaluateChains: IgipPromptChain[] = hasVariables
    ? [
        {
          id: "eval-per-variable",
          title: "Evaluación RAG + LLM por variable",
          repeatLabel: `× ${variableCount} variables`,
          hint: EVALUATE_LLM_CHAIN_HINT,
          nodes: [
            buildEvaluateSystemMessageNode({
              order: 1,
              systemPreview: buildVariableEvalSystemPreview(rubric, evaluation),
              assemblyFlow: evaluateAssemblyFlow,
              relatedConfigActionIds: EVALUATE_SYSTEM_RELATED_CONFIG_ACTIONS,
            }),
            buildEvaluateUserMessageNode({
              order: 2,
              focusLabel: "variable",
              template:
                evaluation.prompts.variableEval?.trim() || DEFAULT_VARIABLE_EVAL_USER_PROMPT,
              templateSource: evaluation.prompts.variableEval?.trim() ? "configuración" : "código",
              orientation: evaluation.phaseInstructions.subdimensionEval?.trim() ?? "",
              userPreview: previewUserMessageWithOrientation(
                evaluation.prompts.variableEval?.trim() || DEFAULT_VARIABLE_EVAL_USER_PROMPT,
                evaluation.phaseInstructions.subdimensionEval?.trim() ?? "",
                {
                  variable: "[variable activa]",
                  knowledgeLabel: evaluation.knowledgeReferenceLabel,
                  levelNumbers: "[escala de niveles]",
                }
              ),
            }),
            chainNode(
              3,
              "output",
              "Respuesta esperada",
              "Análisis con nivel asignado parseado del texto.",
              "El análisis y nivel de cada variable se acumulan en rawEvaluation antes del nivel global.",
              "dinámico"
            ),
          ],
        },
        {
          id: "eval-global-level",
          title: "Nivel global desde variables",
          repeatLabel: "Tras evaluar variables",
          hint: EVALUATE_LLM_CHAIN_HINT,
          nodes: [
            buildEvaluateSystemMessageNode({
              order: 1,
              systemPreview: buildVariableEvalSystemPreview(rubric, evaluation),
              assemblyFlow: evaluateAssemblyFlow,
              relatedConfigActionIds: EVALUATE_SYSTEM_RELATED_CONFIG_ACTIONS,
            }),
            buildLlmUserMessageNode({
              order: 2,
              description:
                "Un solo mensaje user: plantilla de nivel global + orientación + borradores de variables evaluadas.",
              content:
                (evaluation.prompts.globalLevel?.trim() || DEFAULT_GLOBAL_LEVEL_USER_PROMPT) +
                "\n\n[+ borradores de cada variable evaluada]",
              source: evaluation.prompts.globalLevel?.trim() ? "configuración" : "código",
              configActionId: "eval-prompts",
              parts: [
                {
                  title: "Plantilla nivel global",
                  description: "Resumen y asignación del nivel global",
                  source: evaluation.prompts.globalLevel?.trim() ? "configuración" : "código",
                  configActionId: "eval-prompts",
                  content:
                    evaluation.prompts.globalLevel?.trim() || DEFAULT_GLOBAL_LEVEL_USER_PROMPT,
                },
                {
                  title: "Orientación nivel asignado",
                  description: "Instrucciones para la asignación de nivel global",
                  source: "configuración",
                  configActionId: "eval-orientation",
                  content:
                    evaluation.phaseInstructions.assignedLevel?.trim() ||
                    "[Orientación de nivel asignado]",
                },
                {
                  title: "Borradores de variables",
                  description: "Análisis de cada variable evaluada en el paso anterior",
                  source: "dinámico",
                },
              ],
            }),
          ],
        },
      ]
    : [
        {
          id: "eval-assign-level",
          title: "Asignación de nivel global directa",
          hint: EVALUATE_LLM_CHAIN_HINT,
          nodes: [
            buildEvaluateSystemMessageNode({
              order: 1,
              systemPreview: buildVariableEvalSystemPreview(rubric, evaluation),
              assemblyFlow: evaluateAssemblyFlow,
              relatedConfigActionIds: EVALUATE_SYSTEM_RELATED_CONFIG_ACTIONS,
            }),
            buildLlmUserMessageNode({
              order: 2,
              description:
                "Un solo mensaje user: plantilla de asignación de nivel + orientación de nivel asignado.",
              content: evaluation.prompts.assignLevel?.trim() || DEFAULT_ASSIGN_LEVEL_USER_PROMPT,
              source: evaluation.prompts.assignLevel?.trim() ? "configuración" : "código",
              configActionId: "eval-prompts",
              parts: [
                {
                  title: "Plantilla asignar nivel",
                  description: "Escala principal + evidencia del proyecto",
                  source: evaluation.prompts.assignLevel?.trim() ? "configuración" : "código",
                  configActionId: "eval-prompts",
                  content:
                    evaluation.prompts.assignLevel?.trim() || DEFAULT_ASSIGN_LEVEL_USER_PROMPT,
                },
                {
                  title: "Orientación nivel asignado",
                  description: "Instrucciones para la asignación de nivel",
                  source: "configuración",
                  configActionId: "eval-orientation",
                  content:
                    evaluation.phaseInstructions.assignedLevel?.trim() ||
                    "[Orientación de nivel asignado]",
                },
              ],
            }),
          ],
        },
      ];

  const sections = expandReportSections(rubric, reportFormat);
  const perSectionLlmSections = sections.filter(
    (s) =>
      s.kind === "dimension_overview" ||
      (s.kind === "custom" && !/síntesis|sintesis/i.test(s.title))
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
        "Se ejecuta en el orden del informe para secciones libres al inicio (p. ej. resumen). No incluye la síntesis final ni las evaluaciones por variable.",
      nodes: [
        chainNode(
          1,
          "system",
          "System — plantilla de sección",
          "Generada desde formato de informe §6 + rúbrica; puede llevar overrides.",
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
      id: "report-verbatim",
      title: "Variables y nivel asignado",
      repeatLabel: "Sin LLM — copia literal",
      hint:
        "Tras las secciones con LLM, se insertan las evaluaciones por variable y el nivel asignado copiando el texto del paso 4.",
      nodes: [
        chainNode(
          1,
          "context",
          "variable_eval / assigned_level",
          "Las secciones de evaluación por variable y nivel no se reformatean.",
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
        "Última sección del informe (antes del paso 6). Prompt distinto al formateo por sección.",
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
          "Resumen de variables/nivel y extractos del informe parcial.",
          "[evaluationSummary input: borrador + secciones ya formateadas + nivel asignado]",
          "dinámico"
        ),
      ],
    },
  ];

  const levelChains: IgipPromptChain[] = [
    {
      id: "level-result",
      title: "Nivel asignado IMET",
      nodes: [
        chainNode(
          1,
          "output",
          "Nivel global",
          "Sin LLM adicional: parseo del análisis + mayoría de variables.",
          `Se determina el nivel global del emprendimiento (${rubric.levels.map((l) => l.level).join(", ") || "1–N"}) y se integra en el informe final.`,
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
    { stepId: "level", chains: levelChains },
  ];

  return {
    generatedAt: new Date().toISOString(),
    evaluationTypeId,
    steps,
  };
}
