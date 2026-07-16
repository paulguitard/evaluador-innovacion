import type { ContextMode } from "@/lib/rag-limits";
import type { ChatAgentConfig } from "@/lib/chat-agent-config";
import { defaultChatAgentConfig } from "@/lib/chat-agent-config";

/** Fuentes que pueden incluirse en el system prompt. */
export type ContextSource =
  | "config_summary"
  | "report_format"
  | "rubric"
  | "project"
  | "project_structured"
  | "knowledge_rag";

export type AgentLevel = "A" | "B" | "C";

export type ContextComplexity = "simple" | "moderate" | "complex";

/** Plan de construcción del contexto decidido por el agente (Nivel A). */
export type ContextPlan = {
  agentLevel: AgentLevel;
  complexity: ContextComplexity;
  intent: string;
  intentLabel: string;
  sources: ContextSource[];
  excludeSources: ContextSource[];
  ragMode: ContextMode;
  ragQuery: string;
  pageNumber?: number;
  chapterNumber?: number;
  /** Varios capítulos (comparación); si tiene 2+, no usar modo resumen de un solo capítulo. */
  chapterNumbers?: number[];
  comparisonMode?: boolean;
  reasoning: string;
  responseRules: string[];
  /** Si true, el bucle de herramientas (B/C) recopila datos antes del contexto final. */
  useToolLoop: boolean;
  toolsHint: string[];
};

export const ALL_SOURCES: ContextSource[] = [
  "config_summary",
  "report_format",
  "rubric",
  "project",
  "project_structured",
  "knowledge_rag",
];

export function includesSource(plan: ContextPlan | undefined, source: ContextSource): boolean {
  if (!plan) return true;
  if (plan.excludeSources.includes(source)) return false;
  return plan.sources.includes(source);
}

export function validateAndNormalizePlan(
  raw: Partial<ContextPlan>,
  fallback: ContextPlan
): ContextPlan {
  const validSources = new Set(ALL_SOURCES);
  const sources = (raw.sources ?? fallback.sources).filter((s) => validSources.has(s));
  const excludeSources = (raw.excludeSources ?? fallback.excludeSources).filter((s) =>
    validSources.has(s)
  );
  const filtered = sources.filter((s) => !excludeSources.includes(s));

  const agentLevel: AgentLevel =
    raw.agentLevel === "B" || raw.agentLevel === "C" ? raw.agentLevel : fallback.agentLevel;
  const complexity: ContextComplexity =
    raw.complexity === "moderate" || raw.complexity === "complex"
      ? raw.complexity
      : fallback.complexity;

  return {
    agentLevel,
    complexity,
    intent: typeof raw.intent === "string" ? raw.intent : fallback.intent,
    intentLabel: typeof raw.intentLabel === "string" ? raw.intentLabel : fallback.intentLabel,
    sources: filtered.length > 0 ? filtered : fallback.sources,
    excludeSources,
    ragMode: raw.ragMode ?? fallback.ragMode,
    ragQuery: typeof raw.ragQuery === "string" ? raw.ragQuery.trim() : fallback.ragQuery,
    pageNumber: raw.pageNumber ?? fallback.pageNumber,
    chapterNumber: raw.chapterNumber ?? fallback.chapterNumber,
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : fallback.reasoning,
    responseRules: Array.isArray(raw.responseRules)
      ? raw.responseRules.filter((r) => typeof r === "string")
      : fallback.responseRules,
    useToolLoop: raw.useToolLoop ?? fallback.useToolLoop,
    toolsHint: Array.isArray(raw.toolsHint)
      ? raw.toolsHint.filter((t) => typeof t === "string")
      : fallback.toolsHint,
  };
}

/** Plan mínimo solo knowledge (preguntas al manual). */
/** Comparación de varios capítulos del manual (sin modo resumen de un solo capítulo). */
export function multiChapterComparisonPlan(
  ragQuery: string,
  chapterNumbers: number[],
  agentConfig: ChatAgentConfig = defaultChatAgentConfig()
): ContextPlan {
  const chList = chapterNumbers.join(" y ");
  const rules = [
    ...agentConfig.multiChapterResponseRules,
    `Incluye un apartado por cada capítulo mencionado (${chList}) y un apartado final «Comparación» que relacione ambos según la pregunta.`,
  ];
  if (agentConfig.contextHardRules.chapterComparisonNoRubric.trim()) {
    rules.push(agentConfig.contextHardRules.chapterComparisonNoRubric.trim());
  }
  return {
    agentLevel: "C",
    complexity: "complex",
    intent: "knowledge",
    intentLabel: `Comparación manual — capítulos ${chList}`,
    sources: ["knowledge_rag"],
    excludeSources: ["rubric", "report_format", "config_summary"],
    ragMode: "chat-knowledge",
    ragQuery,
    chapterNumbers,
    comparisonMode: true,
    reasoning: `El usuario compara los capítulos ${chList} del manual; incluir fragmentos de cada capítulo.`,
    responseRules: rules,
    useToolLoop: true,
    toolsHint: ["search_knowledge"],
  };
}

export function knowledgeOnlyPlan(
  ragQuery: string,
  page?: number,
  chapter?: number,
  agentConfig: ChatAgentConfig = defaultChatAgentConfig()
): ContextPlan {
  const rules = [...agentConfig.knowledgeResponseRules];
  if (agentConfig.contextHardRules.knowledgeOnlyNoRubric.trim()) {
    const hard = agentConfig.contextHardRules.knowledgeOnlyNoRubric.trim();
    if (!rules.some((r) => r.includes(hard.slice(0, 40)))) {
      rules.push(hard);
    }
  }
  return {
    agentLevel: "A",
    complexity: "simple",
    intent: "knowledge",
    intentLabel: "Manual / Knowledge de referencia",
    sources: ["knowledge_rag"],
    excludeSources: ["rubric", "report_format", "config_summary"],
    ragMode: chapter != null ? "chat-chapter" : page != null ? "chat-knowledge" : "chat-knowledge",
    ragQuery,
    pageNumber: page,
    chapterNumber: chapter,
    reasoning: "Pregunta sobre el manual de referencia; excluir rúbrica y configuración.",
    responseRules: rules,
    useToolLoop: false,
    toolsHint: [],
  };
}

export function bulkEvaluationPlan(
  ragQuery: string,
  agentConfig: ChatAgentConfig = defaultChatAgentConfig()
): ContextPlan {
  return {
    agentLevel: "B",
    complexity: "moderate",
    intent: "bulk_eval",
    intentLabel: "Evaluación masiva",
    sources: ["rubric"],
    excludeSources: [
      "project",
      "project_structured",
      "knowledge_rag",
      "report_format",
      "config_summary",
    ],
    ragMode: "chat-project",
    ragQuery,
    reasoning:
      "Pregunta sobre resultados de evaluación masiva; extracts, notas e informes vienen en el bloque bulk.",
    responseRules: [...agentConfig.bulkResponseRules],
    useToolLoop: true,
    toolsHint: ["list_bulk_projects", "get_rubric"],
  };
}

export function projectOnlyPlan(
  ragQuery: string,
  agentConfig: ChatAgentConfig = defaultChatAgentConfig()
): ContextPlan {
  return {
    agentLevel: "A",
    complexity: "simple",
    intent: "project",
    intentLabel: "Proyecto subido",
    sources: ["project", "project_structured"],
    excludeSources: ["rubric", "knowledge_rag", "report_format"],
    ragMode: "chat-project",
    ragQuery,
    reasoning: "Pregunta sobre datos del proyecto.",
    responseRules: [...agentConfig.projectResponseRules],
    useToolLoop: false,
    toolsHint: [],
  };
}

export function configOnlyPlan(
  agentConfig: ChatAgentConfig = defaultChatAgentConfig()
): ContextPlan {
  return {
    agentLevel: "A",
    complexity: "simple",
    intent: "config",
    intentLabel: "Configuración",
    sources: ["config_summary", "report_format", "rubric"],
    excludeSources: ["knowledge_rag", "project", "project_structured"],
    ragMode: "chat-config",
    ragQuery: "",
    reasoning: "Pregunta sobre configuración, formato o rúbrica.",
    responseRules: [...agentConfig.configResponseRules],
    useToolLoop: false,
    toolsHint: [],
  };
}
