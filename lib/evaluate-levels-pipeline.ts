import { getConfig } from "@/lib/db";
import { getEvaluationTypeByIdPostgres } from "@/lib/db-postgres";
import { buildSystemContext } from "@/lib/build-context";
import { streamChat } from "@/lib/openrouter";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import { EvaluateLlmSemaphore } from "@/lib/evaluate-concurrency";
import {
  collectAssembledReport,
  generateFinalSynthesisSection,
} from "@/lib/assemble-formatted-report";
import {
  enrichReportFormatWithLegacySections,
  findCustomSectionByTitlePattern,
  getSynthesisMaxChars,
  isReportFormatValid,
  mergeReportFormatConfig,
} from "@/lib/report-format-config";
import { stripCharacterLimitAnnotations } from "@/lib/report-format-limits";
import { buildSubdimensionKnowledgeQuery } from "@/lib/evaluate-rag-query";
import {
  isRubricConfigValid,
  mergeRubricConfig,
  type RubricConfigNiveles,
  type RubricVariableConfig,
} from "@/lib/rubric-config";
import {
  computeMajorityLevel,
  extractGlobalLevelSection,
  hasRubricVariables,
  mainLevelsRubricText,
  parseAssignedLevel,
  validLevelNumbers,
  variableEvalContent,
  variableLevelKey,
} from "@/lib/rubric-niveles";
import type { RetrievedChunk } from "@/lib/chunk-types";
import { createEmptyArtifacts } from "@/lib/agent-tools";
import type { EvaluateStreamEvent } from "@/lib/evaluate-pipeline";

async function collectStream(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens: number,
  semaphore?: EvaluateLlmSemaphore
): Promise<string> {
  const run = async () => {
    let out = "";
    for await (const chunk of streamChat(messages, { max_tokens: maxTokens, useCase: "evaluate" })) {
      out += chunk;
    }
    return out;
  };
  return semaphore ? semaphore.run(run) : run();
}

type RagPassParams = {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  ragQuery: string;
  evaluateSubdimension?: { dimensionName: string; name: string; content: string };
  userPrompt: string;
  maxTokens: number;
  knowledgeLabel: string;
  semaphore?: EvaluateLlmSemaphore;
  precomputedKnowledgeChunks?: RetrievedChunk[];
};

async function runRagLlmPass(params: RagPassParams): Promise<string> {
  const systemContent = await buildSystemContext(params.evaluationTypeId, [], {
    projectElementsTable: params.projectElementsTable,
    projectElementsOnly: true,
    excludeReportFormat: true,
    contextMode: "evaluate",
    ragQuery: params.ragQuery,
    evaluateSubdimension: params.evaluateSubdimension,
    agentArtifacts: params.precomputedKnowledgeChunks?.length
      ? { ...createEmptyArtifacts(), knowledgeChunks: params.precomputedKnowledgeChunks }
      : undefined,
  });

  return collectStream(
    [
      {
        role: "system",
        content:
          (systemContent || "Eres evaluador de proyectos.") +
          "\n\nResponde solo con el análisis. No uses etiquetas <think>.",
      },
      { role: "user", content: params.userPrompt },
    ],
    params.maxTokens,
    params.semaphore
  );
}

function assignLevelPrompt(rubric: RubricConfigNiveles, evaluation: EvaluationConfig): string {
  const nums = validLevelNumbers(rubric).join(", ");
  const label = evaluation.knowledgeReferenceLabel;
  const phase = evaluation.phaseInstructions.assignedLevel.trim();
  const mainScale = mainLevelsRubricText(rubric.levels);

  return `Asigna UN ÚNICO nivel global al proyecto según la escala de niveles.

Escala principal de referencia:
${mainScale}

Metodología:
1. Lee los criterios de cada nivel en la rúbrica.
2. Contrasta con los elementos del proyecto y ${label} (Knowledge).
3. Elige el nivel que mejor describe el estado actual del proyecto.

REGLAS:
- Responde con estas secciones (sin límite de caracteres; sé técnico y exhaustivo):
  1. **Análisis** — evidencia del proyecto respecto a los criterios
  2. **Nivel asignado** — una línea exacta: Nivel: N (donde N es uno de: ${nums})
  3. **Justificación** — por qué ese nivel y no otro adyacente

La línea "Nivel: N" debe estar en su propia línea.
No uses etiquetas <think>.
${phase ? `\n\nOrientación adicional:\n${phase}` : ""}`.trim();
}

function variableEvalPrompt(
  variable: RubricVariableConfig,
  rubric: RubricConfigNiveles,
  evaluation: EvaluationConfig
): string {
  const nums = validLevelNumbers(rubric).join(", ");
  const label = evaluation.knowledgeReferenceLabel;
  const phase = evaluation.phaseInstructions.subdimensionEval.trim();

  return `Evalúa la variable/perspectiva "${variable.name}" del proyecto.

Metodología:
1. Interpreta los criterios de cada nivel para esta perspectiva (${nums}).
2. Localiza en los elementos del proyecto la evidencia relevante para "${variable.name}".
3. Con el marco teórico de ${label} (Knowledge), asigna el nivel y redacta análisis y justificación.

Incluye obligatoriamente estas secciones (sin límite de caracteres; sé técnico y exhaustivo):
1. **Análisis** — evaluación rigurosa del proyecto según los criterios de esta variable
2. **Nivel asignado** — OBLIGATORIO:
   - Una línea exacta con el formato: Nivel: N
   - N debe ser uno de: ${nums}
3. **Justificación** — fundamentada en el Knowledge y la evidencia del proyecto

La línea "Nivel: N" debe aparecer en su propia línea, después del Análisis y antes de la Justificación.
${
  phase.trim()
    ? `\n\nOrientación adicional para esta evaluación:\n${phase.trim()}`
    : ""
}

No uses etiquetas <think>. Responde solo con la evaluación de esta variable.`.trim();
}

function globalLevelFromVariablesPrompt(
  rubric: RubricConfigNiveles,
  evaluation: EvaluationConfig,
  variableAnalyses: { name: string; level: number | null; analysis: string }[],
  majorityLevel: number | null
): string {
  const nums = validLevelNumbers(rubric).join(", ");
  const label = evaluation.knowledgeReferenceLabel;
  const phase = evaluation.phaseInstructions.assignedLevel.trim();
  const summary = variableAnalyses
    .map(
      (v) =>
        `- ${v.name}: ${v.level != null ? `Nivel ${v.level}` : "sin nivel parseado"}`
    )
    .join("\n");

  return `Determina el NIVEL GLOBAL del proyecto a partir de las evaluaciones por variable.

Variables evaluadas:
${summary}

Regla de agregación: el nivel global se define por MAYORÍA de los niveles asignados por variable${
    majorityLevel != null ? ` (mayoría sugerida: Nivel ${majorityLevel})` : ""
  }. En empate, prevalece el nivel más alto.

Escala principal:
${mainLevelsRubricText(rubric.levels)}

Evaluaciones por variable (borrador):
${variableAnalyses.map((v) => `### Variable: ${v.name}\n\n${v.analysis.trim()}`).join("\n\n")}

REGLAS — responde de forma más breve que las evaluaciones por variable:
1. **Análisis** — síntesis de cómo convergen (o divergen) las variables
2. **Nivel asignado** — una línea exacta: Nivel: N (donde N es uno de: ${nums})
3. **Justificación** — por qué ese nivel global, citando la mayoría y el Knowledge (${label})

La línea "Nivel: N" debe estar en su propia línea.
No uses etiquetas <think>.
${phase ? `\n\nOrientación adicional:\n${phase}` : ""}`.trim();
}

type VariableEvalResult = {
  index: number;
  variable: RubricVariableConfig;
  analysis: string;
  level: number | null;
};

async function evaluateVariables(
  rubric: RubricConfigNiveles,
  evaluation: EvaluationConfig,
  evaluationTypeId: number,
  projectElementsTable: { element: string; content: string }[],
  semaphore: EvaluateLlmSemaphore,
  precomputedChunks?: Record<string, RetrievedChunk[]>,
  onEvent?: (event: EvaluateStreamEvent) => void
): Promise<VariableEvalResult[]> {
  const total = rubric.variables.length;
  const topN = evaluation.projectElementsInRagQuery;

  const runOne = async (variable: RubricVariableConfig, index: number): Promise<VariableEvalResult> => {
    const content = variableEvalContent(variable);
    const dim = { name: "Variables", content };
    const sub = { name: variable.name, content };
    const ragQuery = buildSubdimensionKnowledgeQuery(dim, sub, projectElementsTable, topN);
    const key = variableLevelKey(variable.name);

    const analysis = await runRagLlmPass({
      evaluationTypeId,
      projectElementsTable,
      ragQuery,
      evaluateSubdimension: {
        dimensionName: "Variables",
        name: variable.name,
        content,
      },
      userPrompt: variableEvalPrompt(variable, rubric, evaluation),
      maxTokens: evaluation.maxTokens.subdimension,
      knowledgeLabel: evaluation.knowledgeReferenceLabel,
      semaphore,
      precomputedKnowledgeChunks: precomputedChunks?.[key],
    });

    const level = parseAssignedLevel(analysis, validLevelNumbers(rubric));
    onEvent?.({
      type: "subdimension",
      dimension: "Variables",
      name: variable.name,
      index: index + 1,
      total,
    });
    onEvent?.({
      type: "variable_level",
      name: variable.name,
      level,
      index: index + 1,
      total,
    });

    return { index, variable, analysis, level };
  };

  const results = evaluation.parallelSubdimensions
    ? await Promise.all(rubric.variables.map((v, i) => runOne(v, i)))
    : await (async () => {
        const out: VariableEvalResult[] = [];
        for (let i = 0; i < rubric.variables.length; i++) {
          out.push(await runOne(rubric.variables[i], i));
        }
        return out;
      })();

  results.sort((a, b) => a.index - b.index);
  return results;
}

function buildRawEvaluationFromVariables(
  variableResults: VariableEvalResult[],
  globalAnalysis: string
): string {
  const variableBlocks = variableResults.map(
    (r) => `### Variable: ${r.variable.name}\n\n${r.analysis.trim()}`
  );
  return `${variableBlocks.join("\n\n")}\n\n---\n\n## Nivel asignado global\n\n${globalAnalysis.trim()}`;
}

/**
 * Evaluación por niveles (IMET/TRL): por variables + nivel global, informe desde §6.
 */
export async function* runEvaluateLevelsPipeline(
  evaluationTypeId: number,
  projectElementsTable: { element: string; content: string }[],
  options?: { precomputedSubdimensionChunks?: Record<string, RetrievedChunk[]> }
): AsyncGenerator<EvaluateStreamEvent, void, unknown> {
  const config = await getConfig(evaluationTypeId);
  if (!config) {
    yield { type: "error", error: "Configuración no encontrada" };
    return;
  }

  const typeRow = await getEvaluationTypeByIdPostgres(evaluationTypeId);
  const rubric = mergeRubricConfig(JSON.parse(config.rubric_config || "{}"), typeRow?.name);
  const evaluation = await getEvaluationConfig(evaluationTypeId);
  const reportFormat = enrichReportFormatWithLegacySections(
    mergeReportFormatConfig(JSON.parse(config.report_format_config || "{}"), rubric),
    rubric,
    (config.report_format ?? "").trim()
  );

  if (rubric.type !== "niveles" || !isRubricConfigValid(rubric)) {
    yield { type: "error", error: "Rúbrica de niveles no configurada correctamente" };
    return;
  }
  if (!isReportFormatValid(reportFormat, rubric)) {
    yield { type: "error", error: "Formato de informe (§6) incompleto" };
    return;
  }

  const synthesisMax = getSynthesisMaxChars(reportFormat, rubric);
  const semaphore = new EvaluateLlmSemaphore();
  const levelNums = validLevelNumbers(rubric);

  let rawEvaluation: string;
  let assignedLevel: number | null;
  let levelTitle = "";

  if (hasRubricVariables(rubric)) {
    yield {
      type: "step",
      message: `Evaluando ${rubric.variables.length} variable(s) de nivel…`,
    };

    const eventQueue: EvaluateStreamEvent[] = [];
    const variableResults = await evaluateVariables(
      rubric,
      evaluation,
      evaluationTypeId,
      projectElementsTable,
      semaphore,
      options?.precomputedSubdimensionChunks,
      (e) => eventQueue.push(e)
    );
    for (const e of eventQueue) yield e;

    const majorityLevel = computeMajorityLevel(variableResults.map((r) => r.level));

    yield {
      type: "step",
      message: "Determinando nivel global del proyecto…",
    };

    const globalAnalysis = await runRagLlmPass({
      evaluationTypeId,
      projectElementsTable,
      ragQuery: [
        mainLevelsRubricText(rubric.levels).slice(0, 600),
        variableResults.map((r) => `${r.variable.name} ${r.level ?? ""}`).join(" "),
      ].join(" "),
      userPrompt: globalLevelFromVariablesPrompt(
        rubric,
        evaluation,
        variableResults.map((r) => ({
          name: r.variable.name,
          level: r.level,
          analysis: r.analysis,
        })),
        majorityLevel
      ),
      maxTokens: evaluation.maxTokens.dimensionOverview,
      knowledgeLabel: evaluation.knowledgeReferenceLabel,
      semaphore,
    });

    rawEvaluation = buildRawEvaluationFromVariables(variableResults, globalAnalysis);
    assignedLevel =
      parseAssignedLevel(extractGlobalLevelSection(rawEvaluation) ?? globalAnalysis, levelNums) ??
      parseAssignedLevel(globalAnalysis, levelNums) ??
      majorityLevel;
  } else {
    yield { type: "step", message: "Evaluando nivel global del proyecto…" };

    const rubricText = mainLevelsRubricText(rubric.levels);
    rawEvaluation = await runRagLlmPass({
      evaluationTypeId,
      projectElementsTable,
      ragQuery: [rubricText.slice(0, 800), projectElementsTable.map((r) => r.element).join(" ")]
        .filter(Boolean)
        .join(" "),
      evaluateSubdimension: {
        dimensionName: "Nivel global",
        name: "Asignación de nivel",
        content: rubricText,
      },
      userPrompt: assignLevelPrompt(rubric, evaluation),
      maxTokens: evaluation.maxTokens.subdimension,
      knowledgeLabel: evaluation.knowledgeReferenceLabel,
    });

    assignedLevel = parseAssignedLevel(rawEvaluation, levelNums);
  }

  const levelMeta = rubric.levels.find((l) => l.level === assignedLevel);
  levelTitle = levelMeta?.title ?? "";

  yield {
    type: "assigned_level" as const,
    level: assignedLevel,
    title: levelTitle,
  };

  yield { type: "formatting", message: "Redactando resúmenes e integrando evaluación según formato…" };

  const custom = evaluation.prompts.formatInstructions?.trim();
  const assembled = await collectAssembledReport({
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    formatInstructionsExtra: custom,
    semaphore,
  });

  let sanitized = stripCharacterLimitAnnotations(assembled);

  const synSection = findCustomSectionByTitlePattern(reportFormat, /síntesis|sintesis/i);
  const hasSynthesis = synthesisMax != null && synthesisMax > 0 && synSection;

  if (hasSynthesis) {
    yield { type: "step", message: "Generando síntesis evaluativa final…" };

    const evaluationSummary = await generateFinalSynthesisSection({
      synSection,
      rubric,
      evaluation,
      rawEvaluation,
      scoreSchema: [],
      subdimensionScores: {},
      overallScore: null,
      assignedLevel,
      levelTitle,
      semaphore,
    });

    yield {
      type: "evaluation_summary",
      text: evaluationSummary.replace(/^##\s*[^\n]+\n+/, "").trim(),
    };

    sanitized = `${sanitized.trimEnd()}\n\n${evaluationSummary.trim()}`;
  }

  yield { type: "report_content", content: sanitized };
  yield { type: "done" };
}
