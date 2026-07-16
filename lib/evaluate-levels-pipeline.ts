import { getConfig } from "@/lib/db";
import { getEvaluationTypeByIdPostgres } from "@/lib/db-postgres";
import { streamChat } from "@/lib/openrouter";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import { getGlobalLlmSemaphore, type EvaluateLlmSemaphore } from "@/lib/evaluate-concurrency";
import { assembleFinalNivelesReportEvents } from "@/lib/assemble-final-report";
import {
  enrichReportFormatWithLegacySections,
  isReportFormatValid,
  mergeReportFormatConfig,
} from "@/lib/report-format-config";
import { stripCharacterLimitAnnotations } from "@/lib/report-format-limits";
import { sanitizeLlmEvaluationText } from "@/lib/llm-output-sanitize";
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
import type { EvaluateStreamEvent } from "@/lib/evaluate-pipeline";
import {
  applyPromptTemplate,
  DEFAULT_ASSIGN_LEVEL_USER_PROMPT,
  DEFAULT_GLOBAL_LEVEL_USER_PROMPT,
  DEFAULT_VARIABLE_EVAL_USER_PROMPT,
  formatOptionalPhaseInstructions,
} from "@/lib/eval-types/prompt-defaults";
import { resolveEvaluateSystemContextWithRetry } from "@/lib/resolve-evaluate-system-context";
import {
  EvaluateSystemContextError,
  validateProjectElementsForEvaluation,
} from "@/lib/evaluate-system-context-strict";

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
    return sanitizeLlmEvaluationText(out);
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
  subdimensionLabel: string;
};

async function runRagLlmPass(params: RagPassParams): Promise<string> {
  validateProjectElementsForEvaluation(params.projectElementsTable);

  const systemMessage = await resolveEvaluateSystemContextWithRetry({
    evaluationTypeId: params.evaluationTypeId,
    projectElementsTable: params.projectElementsTable,
    ragQuery: params.ragQuery,
    evaluateSubdimension: params.evaluateSubdimension,
    precomputedKnowledgeChunks: params.precomputedKnowledgeChunks,
    subdimensionLabel: params.subdimensionLabel,
  });

  return collectStream(
    [
      { role: "system", content: systemMessage },
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
  const phaseBlock = phase ? `\n\nOrientación adicional:\n${phase}` : "";
  const template = evaluation.prompts.assignLevel?.trim() || DEFAULT_ASSIGN_LEVEL_USER_PROMPT;
  return applyPromptTemplate(template, {
    mainScale,
    knowledgeLabel: label,
    levelNumbers: nums,
    phaseInstructions: phaseBlock,
  });
}

function variableEvalPrompt(
  variable: RubricVariableConfig,
  rubric: RubricConfigNiveles,
  evaluation: EvaluationConfig
): string {
  const nums = validLevelNumbers(rubric).join(", ");
  const label = evaluation.knowledgeReferenceLabel;
  const phaseBlock = formatOptionalPhaseInstructions(evaluation.phaseInstructions.subdimensionEval);
  const template = evaluation.prompts.variableEval?.trim() || DEFAULT_VARIABLE_EVAL_USER_PROMPT;
  return applyPromptTemplate(template, {
    variable: variable.name,
    levelNumbers: nums,
    knowledgeLabel: label,
    phaseInstructions: phaseBlock,
  });
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
  const phaseBlock = phase ? `\n\nOrientación adicional:\n${phase}` : "";
  const template = evaluation.prompts.globalLevel?.trim() || DEFAULT_GLOBAL_LEVEL_USER_PROMPT;
  const base = applyPromptTemplate(template, {
    variableSummary: summary,
    majorityLevel: majorityLevel != null ? String(majorityLevel) : "n/d",
    levelNumbers: nums,
    knowledgeLabel: label,
    phaseInstructions: phaseBlock,
  });
  // Adjuntar borradores de variables (siempre necesarios para el LLM).
  return `${base}

Evaluaciones por variable (borrador):
${variableAnalyses.map((v) => `### Variable: ${v.name}\n\n${v.analysis.trim()}`).join("\n\n")}`.trim();
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
      subdimensionLabel: `variable ${variable.name}`,
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
 * Evaluación por niveles (IMET): por variables + nivel global, informe desde §6.
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

  try {
    validateProjectElementsForEvaluation(projectElementsTable);
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  const semaphore = getGlobalLlmSemaphore();
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

    const rubricText = mainLevelsRubricText(rubric.levels);
    const globalAnalysis = await runRagLlmPass({
      evaluationTypeId,
      projectElementsTable,
      ragQuery: [
        rubricText.slice(0, 600),
        variableResults.map((r) => `${r.variable.name} ${r.level ?? ""}`).join(" "),
      ].join(" "),
      evaluateSubdimension: {
        dimensionName: "Nivel global",
        name: "Asignación de nivel",
        content: rubricText,
      },
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
      subdimensionLabel: "nivel global (desde variables)",
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
      subdimensionLabel: "nivel global",
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

  yield { type: "formatting", message: "Informe final: integrando evaluación y redactando secciones con IA…" };

  yield {
    type: "report_draft",
    content: stripCharacterLimitAnnotations(rawEvaluation),
  };

  let assembled: { finalReport: string; evaluationSummary: string } | undefined;

  for await (const event of assembleFinalNivelesReportEvents({
    rubric,
    reportFormat,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    assignedLevel,
    levelTitle,
  })) {
    if (event.type === "step") {
      yield { type: "step", message: event.message };
    } else {
      assembled = event.result;
    }
  }

  if (!assembled) {
    throw new Error("El ensamblado del informe no produjo resultado.");
  }

  if (assembled.evaluationSummary.trim()) {
    yield {
      type: "evaluation_summary",
      text: assembled.evaluationSummary,
    };
  }

  yield { type: "report_content", content: assembled.finalReport };
  yield { type: "done" };
}
