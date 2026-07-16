/**
 * Catálogo UI del hub «Configurar agente»: categorías por tipo de pregunta,
 * tools asociadas y pasos del flujo de encadenado del chat.
 */

export type ChatAgentUiCategoryId =
  | "overview"
  | "router"
  | "knowledge"
  | "multi_chapter"
  | "rubric_score"
  | "bulk_projects"
  | "config_type"
  | "prompts_code";

export type ChatAgentFlowStep = {
  id: string;
  title: string;
  description: string;
  level?: "A" | "B" | "C";
};

export type ChatAgentUiCategory = {
  id: ChatAgentUiCategoryId;
  title: string;
  description: string;
  /** Tools del chat relevantes para este tipo de pregunta. */
  toolNames: string[];
  /** Fuentes de contexto típicas. */
  sources: string[];
  /** Pasos del flujo / encadenado visibles en la UI. */
  flowSteps: ChatAgentFlowStep[];
  /** Campos editables de ChatAgentConfig en esta categoría. */
  editable: Array<
    | "routerSystemPrompt"
    | "knowledgeResponseRules"
    | "multiChapterResponseRules"
    | "bulkResponseRules"
    | "configResponseRules"
    | "projectResponseRules"
    | "contextHardRules"
    | "defaultKnowledgeQuerySuffix"
  >;
  exampleQuestions: string[];
};

/** Flujo global del agente de chat (siempre visible en Overview). */
export const CHAT_AGENT_GLOBAL_FLOW: ChatAgentFlowStep[] = [
  {
    id: "plan",
    title: "1. Planificador (Nivel A)",
    description:
      "Analiza la pregunta y decide sources, excludeSources, agentLevel, toolsHint y responseRules (router LLM + reglas duras).",
    level: "A",
  },
  {
    id: "tools",
    title: "2. Recopilación con tools (Nivel B/C)",
    description:
      "Si useToolLoop=true, el agente llama herramientas (knowledge, rúbrica, bulk projects, config) hasta LISTO.",
    level: "B",
  },
  {
    id: "context",
    title: "3. Armado del system prompt",
    description:
      "buildSystemContext + bloque de evaluación masiva + reglas de respuesta + idioma.",
  },
  {
    id: "answer",
    title: "4. Respuesta final",
    description: "El modelo responde al usuario con el contexto ya recopilado (Nivel A de respuesta).",
    level: "A",
  },
];

export const CHAT_AGENT_UI_CATEGORIES: ChatAgentUiCategory[] = [
  {
    id: "overview",
    title: "Vista general",
    description:
      "Cómo funciona el agente de chat: planificador, tools y respuesta. Independiente del tipo IGIP/IMET.",
    toolNames: [],
    sources: [],
    flowSteps: CHAT_AGENT_GLOBAL_FLOW,
    editable: [],
    exampleQuestions: [
      "¿Qué dice el manual sobre innovación?",
      "Compara ClinicApp y CONenergía",
      "¿Cómo subir Transferencia Tecnológica de 2 a 3?",
    ],
  },
  {
    id: "router",
    title: "Router de contexto",
    description:
      "Prompt del planificador (Nivel A). Decide qué fuentes y tools usar según la pregunta.",
    toolNames: [],
    sources: [
      "config_summary",
      "report_format",
      "rubric",
      "project",
      "project_structured",
      "knowledge_rag",
    ],
    flowSteps: [
      {
        id: "router-llm",
        title: "LLM router",
        description: "Recibe la pregunta + disponibilidad (proyecto, bulk, rúbrica, knowledge) y devuelve JSON del plan.",
        level: "A",
      },
      {
        id: "hard-rules",
        title: "Reglas duras",
        description:
          "applyHardRules / classifyQueryIntents ajustan sources y toolsHint (p. ej. forzar rúbrica al subir nota).",
        level: "A",
      },
    ],
    editable: ["routerSystemPrompt"],
    exampleQuestions: ["Cualquier pregunta del chat — el router corre siempre."],
  },
  {
    id: "knowledge",
    title: "Manual / Knowledge",
    description:
      "Preguntas teóricas, Oslo, definiciones. Solo knowledge_rag; no usa rúbrica ni extracts de proyectos.",
    toolNames: ["search_knowledge"],
    sources: ["knowledge_rag"],
    flowSteps: [
      {
        id: "k-plan",
        title: "Plan knowledgeOnly",
        description: "sources: knowledge_rag. Excluye rubric y config.",
        level: "A",
      },
      {
        id: "k-rag",
        title: "search_knowledge",
        description: "Recupera fragmentos del manual (RAG). Nivel B si hay tool loop.",
        level: "B",
      },
      {
        id: "k-answer",
        title: "Respuesta con reglas Knowledge",
        description: "Aplica knowledgeResponseRules y hard rules sin rúbrica.",
      },
    ],
    editable: [
      "knowledgeResponseRules",
      "contextHardRules",
      "defaultKnowledgeQuerySuffix",
    ],
    exampleQuestions: [
      "¿Qué dice el Manual de Oslo sobre innovación?",
      "¿Qué es la innovación de proceso?",
    ],
  },
  {
    id: "multi_chapter",
    title: "Comparación multi-capítulo",
    description:
      "Comparar dos o más capítulos del manual. Plan dedicado con search_knowledge y reglas de comparación.",
    toolNames: ["search_knowledge"],
    sources: ["knowledge_rag"],
    flowSteps: [
      {
        id: "mc-detect",
        title: "Detectar capítulos",
        description: "parseChaptersFromQuery / isChapterComparisonQuery.",
        level: "A",
      },
      {
        id: "mc-rag",
        title: "RAG multi-capítulo",
        description: "Recupera fragmentos de cada capítulo y arma comparación.",
        level: "C",
      },
    ],
    editable: ["multiChapterResponseRules", "contextHardRules"],
    exampleQuestions: [
      "Compara el capítulo 2 y el capítulo 3 del manual",
      "¿En qué se diferencian los capítulos 1 y 4?",
    ],
  },
  {
    id: "rubric_score",
    title: "Rúbrica y mejora de nota",
    description:
      "Preguntas sobre criterios de evaluación o cómo subir/mejorar una nota (p. ej. de 2 a 3).",
    toolNames: ["get_rubric", "list_bulk_projects", "get_bulk_project", "search_bulk_projects"],
    sources: ["rubric", "config_summary"],
    flowSteps: [
      {
        id: "rs-detect",
        title: "Detectar mejora de nota / rúbrica",
        description: "asksScoreImprovement o mención de rúbrica/IGIP → fuerza source rubric.",
        level: "A",
      },
      {
        id: "rs-tools",
        title: "get_rubric (+ tools bulk si hay evals)",
        description: "Obtiene criterios de nivel y contraste con proyectos evaluados.",
        level: "B",
      },
    ],
    editable: [],
    exampleQuestions: [
      "¿Qué exige la rúbrica para Transferencia Tecnológica nota 3?",
      "¿Cómo subir Transferencia Tecnológica de 2 a 3?",
    ],
  },
  {
    id: "bulk_projects",
    title: "Proyectos y evaluación masiva",
    description:
      "Comparar proyectos, extracts, informes, notas IGIP. Usa el bloque bulk + tools multi-proyecto.",
    toolNames: [
      "list_bulk_projects",
      "get_bulk_project",
      "search_bulk_projects",
      "get_rubric",
    ],
    sources: ["rubric"],
    flowSteps: [
      {
        id: "bp-plan",
        title: "Plan bulk_eval",
        description: "sources rubric; datos de proyectos vienen en bulkProjects / bulkEvaluationContext.",
        level: "A",
      },
      {
        id: "bp-list",
        title: "list_bulk_projects",
        description: "Lista nombres, IGIP y notas.",
        level: "B",
      },
      {
        id: "bp-detail",
        title: "get_bulk_project / search_bulk_projects",
        description: "Detalle de extracts e informes o búsqueda transversal.",
        level: "B",
      },
      {
        id: "bp-answer",
        title: "Respuesta comparativa",
        description: "Aplica bulkResponseRules; puede citar rúbrica si aplica.",
        level: "C",
      },
    ],
    editable: ["bulkResponseRules"],
    exampleQuestions: [
      "Compara ClinicApp y CONenergía en transferencia tecnológica",
      "¿Cuál tiene mejor indicador IGIP?",
      "¿Qué dice el extracto del objetivo general de cada proyecto?",
    ],
  },
  {
    id: "config_type",
    title: "Configuración del tipo",
    description:
      "Preguntas sobre metodología, formato de informe, elementos a identificar o rúbrica configurada.",
    toolNames: ["get_config", "get_rubric"],
    sources: ["config_summary", "report_format", "rubric"],
    flowSteps: [
      {
        id: "cfg-plan",
        title: "Plan configOnly",
        description: "sources config_summary, report_format, rubric.",
        level: "A",
      },
      {
        id: "cfg-tools",
        title: "get_config / get_rubric",
        description: "Lee secciones de configuración del tipo activo.",
        level: "B",
      },
    ],
    editable: ["configResponseRules", "projectResponseRules"],
    exampleQuestions: [
      "¿Cuál es el formato del informe?",
      "¿Qué elementos se identifican en la extracción?",
      "¿Cómo está configurada la rúbrica?",
    ],
  },
  {
    id: "prompts_code",
    title: "Prompts de sistema (código)",
    description:
      "Prompts fijos del orquestador (tool-loop, idioma, instrucción base). Solo lectura; se editan en código o vía catálogo.",
    toolNames: [],
    sources: [],
    flowSteps: [
      {
        id: "pc-tool-loop",
        title: "Tool-loop system",
        description: "CHAT_TOOL_LOOP_SYSTEM_PROMPT — bucle B/C.",
        level: "B",
      },
      {
        id: "pc-lang",
        title: "Idioma + base",
        description: "Prefijo español + instrucción base de respuesta.",
      },
    ],
    editable: [],
    exampleQuestions: [],
  },
];

export function getChatAgentUiCategory(
  id: ChatAgentUiCategoryId
): ChatAgentUiCategory | undefined {
  return CHAT_AGENT_UI_CATEGORIES.find((c) => c.id === id);
}
