import {
  extractSubdimensionSection,
  type RubricScoreSchemaEntry,
} from "@/lib/evaluation-scores";
import type { EvaluateLlmSemaphore } from "@/lib/evaluate-concurrency";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import {
  buildFinalSynthesisSystemPrompt,
  buildFinalSynthesisSystemPromptForLevels,
  buildIncompleteSectionRetryUser,
  buildSectionFormatSystemPrompt,
  buildSectionFormatUserPrompt,
  buildSynthesisSourceMaterial,
  buildSynthesisSourceMaterialForLevels,
  customSectionToReportSection,
  estimateSectionMaxTokens,
  extractSectionBody,
  isSectionTextComplete,
  resolveSectionSource,
} from "@/lib/format-report-sections";
import { buildDeterministicLevelsEvaluationSummary } from "@/lib/evaluation-scores";
import {
  extractGlobalLevelSection,
  extractVariableSection,
} from "@/lib/rubric-niveles";
import {
  expandReportSections,
  type ReportCustomSection,
  type ReportFormatConfig,
  type ReportSection,
} from "@/lib/report-format-config";
import type { RubricConfig } from "@/lib/rubric-config";

export type AssembleFormattedReportOptions = {
  rubric: RubricConfig;
  reportFormat: ReportFormatConfig;
  rawEvaluation: string;
  projectElementsTable: { element: string; content: string }[];
  evaluation: EvaluationConfig;
  formatInstructionsExtra?: string;
  semaphore?: EvaluateLlmSemaphore;
  streamSection?: (
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    maxTokens: number
  ) => AsyncGenerator<string, void, unknown>;
};

export type GenerateFinalSynthesisOptions = {
  synSection: ReportCustomSection;
  rubric: RubricConfig;
  evaluation: EvaluationConfig;
  rawEvaluation: string;
  scoreSchema: RubricScoreSchemaEntry[];
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
  assignedLevel?: number | null;
  levelTitle?: string;
  semaphore?: EvaluateLlmSemaphore;
  streamSection?: AssembleFormattedReportOptions["streamSection"];
};

export function isSynthesisSection(section: ReportSection): boolean {
  return section.kind === "custom" && /síntesis|sintesis/i.test(section.title);
}

export function formatSubdimensionBlock(
  section: ReportSection,
  rubric: RubricConfig,
  rawEvaluation: string
): string {
  let body = "";
  if (
    section.kind === "subdimension_eval" &&
    section.subdimensionId &&
    rubric.type === "ponderaciones"
  ) {
    for (const dim of rubric.dimensions) {
      const sub = dim.subdimensions.find((s) => s.id === section.subdimensionId);
      if (sub) {
        body = extractSubdimensionSection(rawEvaluation, sub.name) ?? "";
        break;
      }
    }
  }
  const trimmed = body.trim();
  if (!trimmed) return `## ${section.title}\n\n`;
  return `## ${section.title}\n\n${trimmed}`;
}

export function formatVariableBlock(
  section: ReportSection,
  rubric: RubricConfig,
  rawEvaluation: string
): string {
  if (section.kind !== "variable_eval" || !section.variableId || rubric.type !== "niveles") {
    return `## ${section.title}\n\n`;
  }
  const variable = rubric.variables.find((v) => v.id === section.variableId);
  if (!variable) return `## ${section.title}\n\n`;
  const body = extractVariableSection(rawEvaluation, variable.name)?.trim() ?? "";
  if (!body) return `## ${section.title}\n\n`;
  return `## ${section.title}\n\n${body}`;
}

export function formatAssignedLevelBlock(
  section: ReportSection,
  rawEvaluation: string
): string {
  const body = extractGlobalLevelSection(rawEvaluation)?.trim() ?? rawEvaluation.trim();
  if (!body) return `## ${section.title}\n\n`;
  return `## ${section.title}\n\n${body}`;
}

function sectionNeedsLlm(section: ReportSection): boolean {
  if (section.kind === "dimension_overview") return true;
  if (section.kind === "custom" && !isSynthesisSection(section)) return true;
  return false;
}

function sectionHasHeader(text: string, title: string): boolean {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)\\s*#{1,3}\\s*${escaped}\\b`, "i").test(text.trim());
}

function ensureSectionHeader(text: string, title: string): string {
  const trimmed = text.trim();
  if (!trimmed) return `## ${title}\n\n`;
  if (sectionHasHeader(trimmed, title)) return trimmed;
  return `## ${title}\n\n${trimmed}`;
}

function looksLikeRawProjectPaste(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  const labelHits = lines.filter((l) =>
    /^(nombre del proyecto|objetivo general|objetivos específicos|público objetivo|actividades del proyecto|indicadores)\b/i.test(
      l.trim()
    )
  );
  return labelHits.length >= 3;
}

async function streamToText(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens: number,
  options: Pick<AssembleFormattedReportOptions, "streamSection" | "semaphore">
): Promise<string> {
  const run = async (): Promise<string> => {
    let buf = "";
    if (options.streamSection) {
      for await (const chunk of options.streamSection(messages, maxTokens)) {
        buf += chunk;
      }
    } else {
      const { streamChat } = await import("@/lib/openrouter");
      for await (const chunk of streamChat(messages, {
        max_tokens: maxTokens,
        useCase: "evaluate",
      })) {
        buf += chunk;
      }
    }
    return buf;
  };
  return options.semaphore ? options.semaphore.run(run) : run();
}

async function callLlmSection(
  section: ReportSection,
  system: string,
  user: string,
  maxTokens: number,
  options: Pick<AssembleFormattedReportOptions, "streamSection" | "semaphore">
): Promise<string> {
  try {
    return (
      await streamToText(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens,
        options
      )
    ).trim();
  } catch {
    return "";
  }
}

function sectionTextIsAcceptable(section: ReportSection, llmText: string): boolean {
  const body = extractSectionBody(llmText, section.title);
  if (!body) return false;
  if (!isSectionTextComplete(body, section.minChars)) return false;
  if (
    section.kind === "custom" &&
    /resumen.*proyecto|proyecto.*resumen/i.test(section.title) &&
    looksLikeRawProjectPaste(llmText)
  ) {
    return false;
  }
  return true;
}

async function requestLlmSection(
  section: ReportSection,
  system: string,
  user: string,
  maxTokens: number,
  options: Pick<AssembleFormattedReportOptions, "streamSection" | "semaphore">,
  sourceForRetry = ""
): Promise<string> {
  const tokenCeiling = Math.min(8192, Math.max(maxTokens, estimateSectionMaxTokens(section)));
  let tokens = tokenCeiling;
  let best = "";
  let lastUser = user;

  for (let attempt = 0; attempt < 5; attempt++) {
    const llmText = await callLlmSection(section, system, lastUser, tokens, options);
    if (llmText.length > best.length) best = llmText;
    if (sectionTextIsAcceptable(section, llmText)) {
      return llmText;
    }
    tokens = Math.min(8192, Math.ceil(tokens * 1.25));
    if (sourceForRetry.trim()) {
      lastUser = buildIncompleteSectionRetryUser(section, sourceForRetry);
    }
  }

  return best;
}

async function collectLlmSection(
  section: ReportSection,
  options: AssembleFormattedReportOptions
): Promise<string> {
  const {
    rubric,
    rawEvaluation,
    projectElementsTable,
    evaluation,
    formatInstructionsExtra,
  } = options;

  const source = resolveSectionSource(
    section,
    rubric,
    rawEvaluation,
    projectElementsTable
  );
  let system = buildSectionFormatSystemPrompt(section, rubric);
  if (formatInstructionsExtra?.trim()) {
    system += `\n\n${formatInstructionsExtra.trim()}`;
  }
  const user = buildSectionFormatUserPrompt(section, source);
  const maxTokens = Math.min(
    evaluation.maxTokens.formatReport,
    estimateSectionMaxTokens(section)
  );

  let llmText = await requestLlmSection(
    section,
    system,
    user,
    maxTokens,
    options,
    source
  );

  if (sectionTextIsAcceptable(section, llmText)) {
    return ensureSectionHeader(llmText, section.title);
  }

  const retryUser = buildIncompleteSectionRetryUser(section, source);
  llmText = await requestLlmSection(
    section,
    system,
    retryUser,
    8192,
    options,
    source
  );

  return ensureSectionHeader(llmText, section.title);
}

function llmSectionCacheKey(section: ReportSection): string {
  if (section.kind === "dimension_overview") {
    return `dimension_overview:${section.dimensionId ?? section.title}`;
  }
  return `custom:${section.title}`;
}

async function prefetchLlmSections(
  sections: ReportSection[],
  options: AssembleFormattedReportOptions
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const llmSections = sections.filter(
    (section) => sectionNeedsLlm(section) && !isSynthesisSection(section)
  );

  await Promise.all(
    llmSections.map(async (section) => {
      const text = await collectLlmSection(section, options);
      cache.set(llmSectionCacheKey(section), text);
    })
  );

  return cache;
}

export async function generateFinalSynthesisSection(
  options: GenerateFinalSynthesisOptions
): Promise<string> {
  const {
    synSection,
    rubric,
    evaluation,
    rawEvaluation,
    scoreSchema,
    subdimensionScores,
    overallScore,
    assignedLevel,
    levelTitle,
    semaphore,
    streamSection,
  } = options;

  const section = customSectionToReportSection(synSection);
  const source =
    rubric.type === "niveles"
      ? buildSynthesisSourceMaterialForLevels(
          rawEvaluation,
          assignedLevel ?? null,
          levelTitle ?? "",
          evaluation.indicatorLabel
        )
      : buildSynthesisSourceMaterial(
          rawEvaluation,
          scoreSchema,
          subdimensionScores,
          overallScore,
          evaluation.indicatorLabel
        );
  const system =
    rubric.type === "niveles"
      ? buildFinalSynthesisSystemPromptForLevels(
          section,
          assignedLevel ?? null,
          levelTitle ?? ""
        )
      : buildFinalSynthesisSystemPrompt(section);
  const user = `Redacta la síntesis evaluativa final según las instrucciones.

${source}

Responde solo con la sección formateada.`;
  const maxTokens = Math.min(
    evaluation.maxTokens.formatReport,
    estimateSectionMaxTokens(section)
  );
  const llmOpts = { semaphore, streamSection };

  let text = await requestLlmSection(section, system, user, maxTokens, llmOpts, source);
  if (!sectionTextIsAcceptable(section, text)) {
    text = await requestLlmSection(
      section,
      system,
      buildIncompleteSectionRetryUser(section, source),
      8192,
      llmOpts,
      source
    );
  }

  if (!sectionTextIsAcceptable(section, text) && rubric.type === "niveles") {
    const fallback = buildDeterministicLevelsEvaluationSummary(
      assignedLevel ?? null,
      levelTitle ?? "",
      evaluation.indicatorLabel,
      rawEvaluation,
      section.maxChars
    );
    text = `## ${section.title}\n\n${fallback}`;
  }

  return ensureSectionHeader(text, section.title);
}

export async function* assembleFormattedReport(
  options: AssembleFormattedReportOptions
): AsyncGenerator<string, void, unknown> {
  const { rubric, reportFormat, rawEvaluation } = options;
  const sections = expandReportSections(rubric, reportFormat);
  const llmCache = await prefetchLlmSections(sections, options);
  let isFirst = true;

  const prefix = (): string => {
    if (isFirst) {
      isFirst = false;
      return "";
    }
    return "\n\n";
  };

  for (const section of sections) {
    if (isSynthesisSection(section)) continue;

    if (section.kind === "subdimension_eval") {
      yield prefix() + formatSubdimensionBlock(section, rubric, rawEvaluation);
      continue;
    }

    if (section.kind === "variable_eval") {
      yield prefix() + formatVariableBlock(section, rubric, rawEvaluation);
      continue;
    }

    if (section.kind === "assigned_level") {
      yield prefix() + formatAssignedLevelBlock(section, rawEvaluation);
      continue;
    }

    if (sectionNeedsLlm(section)) {
      const cached = llmCache.get(llmSectionCacheKey(section));
      yield prefix() + (cached ?? `## ${section.title}\n\n`);
    }
  }
}

export async function collectAssembledReport(
  options: AssembleFormattedReportOptions
): Promise<string> {
  let out = "";
  for await (const chunk of assembleFormattedReport(options)) {
    out += chunk;
  }
  return out;
}

export function countSubdimensionTitleOccurrences(
  report: string,
  subdimensionName: string
): number {
  const escaped = subdimensionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\d+\\.\\s*)?${escaped}\\b`,
    "gi"
  );
  return [...report.matchAll(re)].length;
}
