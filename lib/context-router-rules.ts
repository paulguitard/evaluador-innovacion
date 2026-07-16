import {
  parseChaptersFromQuery,
  isChapterComparisonQuery,
} from "@/lib/chat-intent";
import {
  type ContextPlan,
  type ContextSource,
  validateAndNormalizePlan,
  knowledgeOnlyPlan,
  multiChapterComparisonPlan,
  configOnlyPlan,
  bulkEvaluationPlan,
} from "@/lib/context-plan";
import type { ChatAgentConfig } from "@/lib/chat-agent-config";

export type RouterInput = {
  message: string;
  hasProjectData: boolean;
  hasBulkEvaluationData?: boolean;
  hasRubric: boolean;
  hasKnowledge: boolean;
};

export type QueryIntents = {
  wantsKnowledge: boolean;
  wantsRubric: boolean;
  wantsConfig: boolean;
  wantsBulkProjects: boolean;
  wantsScoreImprovement: boolean;
  comparesMultiple: boolean;
  multiChapter: boolean;
};

/** Detecta preguntas sobre subir/mejorar nota o pasar de un nivel a otro. */
export function asksScoreImprovement(message: string): boolean {
  const m = message.toLowerCase();
  const hasImprovementVerb =
    /\b(subir|mejorar|elevar|aumentar|pasar|raise|improve|increase)\b/i.test(m);
  const hasScoreTerm =
    /\b(nota|puntuaci[oó]n|nivel|calificaci[oó]n|score|grade)\b/i.test(m);
  const hasLevelTransition =
    /\bde\s+\d+\s+a\s+\d+\b/i.test(m) || /\bfrom\s+a?\s*\d+\s+to\s+\d+\b/i.test(m);
  return (
    (hasImprovementVerb && hasScoreTerm) ||
    (hasImprovementVerb && hasLevelTransition) ||
    (hasScoreTerm && hasLevelTransition)
  );
}

export function classifyQueryIntents(message: string, input: RouterInput): QueryIntents {
  const m = message.toLowerCase();
  const wantsKnowledge =
    /\b(manual|knowledge|oslo|marco\s+te[oó]rico)\b/i.test(message) ||
    /\bqu[eé]\s+es\s+la\s+innovaci[oó]n\b/i.test(message);
  const wantsScoreImprovement = asksScoreImprovement(message);
  const wantsRubric =
    /\br[uú]brica\b/i.test(message) ||
    /\bcriterios?\s+de\s+evaluaci[oó]n\b/i.test(message) ||
    /\bigip\b/i.test(message) ||
    wantsScoreImprovement;
  const wantsConfig =
    /\b(evaluaci[oó]n|formato\s+del\s+informe|elementos?\s+a\s+identificar|configuraci[oó]n)\b/i.test(
      message
    ) && !wantsBulkProjectsHint(message, input);
  const wantsBulkProjects =
    !!input.hasBulkEvaluationData &&
  (
    /\bproyecto(s)?\b/i.test(message) ||
    wantsScoreImprovement ||
    /\bcompar(a|ar|ación)\b/i.test(m) ||
    /\bevaluaci[oó]n(es)?\b/i.test(message) ||
    /\binforme(s)?\b/i.test(message) ||
    /\bextract(o|os)?\b/i.test(message) ||
    /\bmejor(ar|a)\b/i.test(message) ||
    /\bnota(s)?\b/i.test(message) ||
    /\bsubdimensi[oó]n\b/i.test(message)
  );
  const comparesMultiple =
    (wantsKnowledge && wantsBulkProjects) ||
    (wantsKnowledge && wantsRubric) ||
    (wantsBulkProjects && wantsRubric) ||
    /\bcompar(a|ar|ación)\b/i.test(m) ||
    /\bseg[uú]n\s+el\s+manual\b.*\bproyecto\b/i.test(m) ||
    /\bmanual\b.*\by\b.*\bproyecto\b/i.test(m);
  const chapterNumbers = parseChaptersFromQuery(message);
  const multiChapter = chapterNumbers.length >= 2 || isChapterComparisonQuery(message);

  return {
    wantsKnowledge,
    wantsRubric,
    wantsConfig,
    wantsBulkProjects,
    wantsScoreImprovement,
    comparesMultiple,
    multiChapter,
  };
}

function wantsBulkProjectsHint(message: string, input: RouterInput): boolean {
  const m = message.toLowerCase();
  return (
    !!input.hasBulkEvaluationData &&
    (/\bproyecto(s)?\b/i.test(message) ||
      asksScoreImprovement(message) ||
      /\bcompar(a|ar|ación)\b/i.test(m) ||
      /\bevaluaci[oó]n(es)?\b/i.test(message))
  );
}

const BULK_TOOLS = ["list_bulk_projects", "get_bulk_project", "search_bulk_projects"] as const;

function composePlanFromIntents(
  message: string,
  input: RouterInput,
  intents: QueryIntents,
  agentConfig: ChatAgentConfig,
  base: ContextPlan
): ContextPlan {
  const chapterNumbers = parseChaptersFromQuery(message);
  const bulkOnly = !!input.hasBulkEvaluationData && !input.hasProjectData;

  if (intents.multiChapter && intents.wantsKnowledge && chapterNumbers.length >= 2) {
    return multiChapterComparisonPlan(message, chapterNumbers, agentConfig);
  }

  if (intents.wantsKnowledge && !intents.wantsRubric && !intents.wantsConfig && !intents.wantsBulkProjects) {
    return knowledgeOnlyPlan(message, base.pageNumber, base.chapterNumber, agentConfig);
  }

  if (intents.wantsConfig && !intents.wantsKnowledge && !intents.wantsBulkProjects && !intents.wantsRubric) {
    return configOnlyPlan(agentConfig);
  }

  const sources = new Set<ContextSource>();
  const excludeSources = new Set<ContextSource>();
  const toolsHint = new Set<string>();
  let agentLevel: ContextPlan["agentLevel"] = "A";
  let complexity: ContextPlan["complexity"] = "simple";
  let useToolLoop = false;
  let intent = bulkOnly ? "bulk_eval" : base.intent;
  let intentLabel = bulkOnly ? "Evaluación masiva" : base.intentLabel;
  let responseRules = [
    ...(bulkOnly ? bulkEvaluationPlan(message, agentConfig).responseRules : base.responseRules),
  ];

  if (intents.wantsKnowledge) {
    sources.add("knowledge_rag");
    toolsHint.add("search_knowledge");
  } else {
    excludeSources.add("knowledge_rag");
  }

  if (intents.wantsRubric && input.hasRubric) {
    sources.add("rubric");
    sources.add("config_summary");
    toolsHint.add("get_rubric");
  } else {
    excludeSources.add("rubric");
  }

  if (intents.wantsConfig) {
    sources.add("config_summary");
    sources.add("report_format");
    toolsHint.add("get_config");
  }

  if (input.hasProjectData) {
    sources.add("project");
    sources.add("project_structured");
    toolsHint.add("get_project_elements");
  } else {
    excludeSources.add("project");
    excludeSources.add("project_structured");
  }

  if (intents.wantsBulkProjects) {
    for (const t of BULK_TOOLS) toolsHint.add(t);
    if (intents.wantsRubric) toolsHint.add("get_rubric");
    intent = "bulk_eval";
    intentLabel = intents.wantsScoreImprovement
      ? "Mejora de nota — evaluación masiva"
      : intents.comparesMultiple
        ? "Comparación de proyectos evaluados"
        : "Evaluación masiva";
  }

  const intentCount = [
    intents.wantsKnowledge,
    intents.wantsRubric,
    intents.wantsConfig,
    intents.wantsBulkProjects,
    input.hasProjectData,
  ].filter(Boolean).length;

  if (intents.comparesMultiple || intentCount >= 2 || intents.wantsScoreImprovement) {
    agentLevel = "C";
    complexity = "complex";
    useToolLoop = true;
  } else if (toolsHint.size > 0) {
    agentLevel = "B";
    complexity = "moderate";
    useToolLoop = true;
  }

  if (intents.wantsRubric && intents.wantsKnowledge) {
    responseRules = [
      "Responde en español usando la rúbrica configurada y los fragmentos del Knowledge.",
      "Indica fortalezas, debilidades y recomendaciones concretas.",
    ];
  }

  if (intents.wantsBulkProjects) {
    responseRules = [
      ...bulkEvaluationPlan(message, agentConfig).responseRules,
      ...responseRules,
    ];
  }

  return {
    agentLevel,
    complexity,
    intent,
    intentLabel,
    sources: [...sources],
    excludeSources: [...excludeSources],
    ragMode: intents.wantsKnowledge ? "chat-knowledge" : "chat-project",
    ragQuery: base.ragQuery || message,
    pageNumber: base.pageNumber,
    chapterNumber: base.chapterNumber,
    chapterNumbers: base.chapterNumbers,
    comparisonMode: base.comparisonMode,
    reasoning:
      intents.wantsBulkProjects && intents.wantsKnowledge
        ? "Pregunta mixta: proyectos evaluados en masa y manual de referencia."
        : intents.wantsBulkProjects
          ? "Pregunta sobre proyectos evaluados en masa."
          : base.reasoning,
    responseRules: [...new Set(responseRules)],
    useToolLoop,
    toolsHint: [...toolsHint],
  };
}

/** Reglas duras del planificador. */
export function applyHardRules(
  plan: ContextPlan,
  message: string,
  input: RouterInput,
  agentConfig: ChatAgentConfig
): ContextPlan {
  const intents = classifyQueryIntents(message, input);
  const bulkOnly = !!input.hasBulkEvaluationData && !input.hasProjectData;

  let p: ContextPlan;
  if (bulkOnly) {
    p = composePlanFromIntents(
      message,
      input,
      intents,
      agentConfig,
      bulkEvaluationPlan(message, agentConfig)
    );
  } else if (intents.wantsKnowledge && !intents.wantsRubric && !intents.wantsBulkProjects && !intents.wantsConfig) {
    p = knowledgeOnlyPlan(message, plan.pageNumber, plan.chapterNumber, agentConfig);
    if (intents.wantsKnowledge && input.hasProjectData) {
      p = {
        ...p,
        sources: ["knowledge_rag", "project", "project_structured"],
        excludeSources: ["rubric", "report_format", "config_summary"],
        agentLevel: "B",
        complexity: "moderate",
        useToolLoop: true,
        intent: "mixed",
        intentLabel: "Manual y proyecto",
        toolsHint: ["search_knowledge", "get_project_elements"],
        responseRules: [
          ...agentConfig.knowledgeResponseRules,
          ...agentConfig.projectResponseRules,
        ],
      };
    }
  } else {
    p = composePlanFromIntents(message, input, intents, agentConfig, plan);
  }

  if (!input.hasProjectData) {
    p.sources = p.sources.filter((s) => s !== "project" && s !== "project_structured");
    p.toolsHint = p.toolsHint.filter(
      (t) =>
        t !== "get_project_elements" &&
        t !== "search_project" &&
        t !== "reextract_project_element"
    );
  }
  if (!input.hasRubric) {
    p.sources = p.sources.filter((s) => s !== "rubric");
    p.toolsHint = p.toolsHint.filter((t) => t !== "get_rubric");
  }
  if (!input.hasKnowledge) {
    p.sources = p.sources.filter((s) => s !== "knowledge_rag");
    p.toolsHint = p.toolsHint.filter((t) => t !== "search_knowledge");
  }
  if (!input.hasBulkEvaluationData) {
    p.toolsHint = p.toolsHint.filter(
      (t) => !BULK_TOOLS.includes(t as (typeof BULK_TOOLS)[number])
    );
  }

  if (p.toolsHint.length > 0 && !p.useToolLoop) {
    p = {
      ...p,
      useToolLoop: true,
      agentLevel: p.agentLevel === "A" ? "B" : p.agentLevel,
      complexity: p.complexity === "simple" ? "moderate" : p.complexity,
    };
  }

  return validateAndNormalizePlan(p, configOnlyPlan(agentConfig));
}
