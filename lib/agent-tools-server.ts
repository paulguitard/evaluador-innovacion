import "server-only";

import { AGENT_TOOL_DEFINITIONS } from "@/lib/agent-tools";
import { PROJECT_EXTRACT_TOOL_DEFINITIONS } from "@/lib/project-extract-llm";
import {
  toolEntry,
  type AgentToolCategory,
  type AgentToolsCatalogResponse,
} from "@/lib/agent-tools-catalog";

function formatSchema(parameters: unknown): string {
  return JSON.stringify(parameters ?? { type: "object", properties: {} }, null, 2);
}

function defDescription(def: { function: { description?: string } }): string {
  return def.function.description?.trim() ?? "";
}

const CHAT_TOOL_META: Record<
  string,
  Omit<Parameters<typeof toolEntry>[2], "name"> & {
    title: string;
    usedIn: string;
    implementedIn: string;
    configurableIn?: string;
  }
> = {
  search_knowledge: {
    title: "Buscar en Knowledge (RAG)",
    description:
      "Recupera fragmentos del manual de referencia indexado (Oslo, documentación). El router la sugiere en preguntas sobre marco teórico, definiciones o capítulos del manual.",
    usedIn:
      "Chat (niveles B/C): bucle tool-calling en lib/agent-orchestrator.ts. También como respaldo en runPlannedTools() cuando el LLM no devuelve tool calls.",
    implementedIn: "lib/agent-tools.ts → executeAgentTool",
    configurableIn: "Configuración → Evaluación → RAG (topK, maxRetrievedChars por modo)",
  },
  search_project: {
    title: "Buscar en el proyecto (chat)",
    description:
      "Búsqueda semántica en los archivos del proyecto subido en la sesión. Útil cuando la pregunta del chat requiere contenido no cubierto por los elementos ya extraídos.",
    usedIn:
      "Chat (niveles B/C): bucle tool-calling y runPlannedTools(). Distinta de la herramienta homónima del agente de extracción (parámetros distintos).",
    implementedIn: "lib/agent-tools.ts → searchProjectForQuery (lib/project-extract-tools.ts)",
    configurableIn: "Configuración → Evaluación → RAG (modo chat-project)",
  },
  get_rubric: {
    title: "Obtener rúbrica",
    description:
      "Devuelve el texto de la rúbrica y criterios de evaluación configurados para el tipo IGIP/IMET activo.",
    usedIn: "Chat (niveles B/C) cuando el plan incluye la fuente rubric o toolsHint sugiere get_rubric.",
    implementedIn: "lib/agent-tools.ts → getConfig (rubric_prompt)",
    configurableIn: "Configuración → Rúbrica",
  },
  get_config: {
    title: "Leer configuración",
    description:
      "Lee secciones de la configuración del tipo de evaluación: evaluación, formato de informe, elementos o resumen.",
    usedIn: "Chat (niveles B/C) para preguntas sobre metodología, formato o elementos configurados.",
    implementedIn: "lib/agent-tools.ts → getConfig",
    configurableIn: "Configuración (secciones según section)",
  },
  get_project_elements: {
    title: "Leer elementos extraídos",
    description:
      "Devuelve la tabla de elementos ya extraídos del proyecto. Permite filtrar por nombre de elemento.",
    usedIn:
      "Chat (niveles B/C) cuando el plan incluye project. Respuestas sobre objetivos, actividades, etc. suelen usar esta herramienta o el contexto precargado.",
    implementedIn: "lib/agent-tools.ts (tabla projectElementsTable de la sesión)",
  },
  reextract_project_element: {
    title: "Re-extraer elemento",
    description:
      "Lanza de nuevo el pipeline de extracción para un elemento vacío o incompleto. Solo para casos difíciles; coste alto en tiempo y tokens.",
    usedIn:
      "Chat nivel C y runPlannedTools() cuando hay filas vacías en la tabla de elementos. También puede añadirse al plan en agent-orchestrator.",
    implementedIn: "lib/agent-tools.ts → retryExtractElement (lib/project-extract-pipeline.ts)",
    configurableIn: "Configuración → Evaluación → Extracción (estrategias y agente LLM)",
  },
  list_bulk_projects: {
    title: "Listar proyectos masivos",
    description:
      "Lista proyectos evaluados en masa con IGIP y notas por subdimensión.",
    usedIn: "Chat masivo cuando el plan incluye datos de evaluación masiva.",
    implementedIn: "lib/agent-tools.ts → lib/bulk-chat-tools.ts",
  },
  get_bulk_project: {
    title: "Obtener proyecto masivo",
    description:
      "Devuelve extracts, notas, resumen e informe de un proyecto evaluado en masa.",
    usedIn: "Chat masivo para preguntas sobre un proyecto concreto.",
    implementedIn: "lib/agent-tools.ts → lib/bulk-chat-tools.ts",
  },
  search_bulk_projects: {
    title: "Buscar en proyectos masivos",
    description:
      "Busca texto en extracts, resúmenes e informes de todos los proyectos evaluados.",
    usedIn: "Chat masivo para comparaciones y búsquedas transversales.",
    implementedIn: "lib/agent-tools.ts → lib/bulk-chat-tools.ts",
  },
};

const EXTRACT_TOOL_META: Record<
  string,
  Omit<Parameters<typeof toolEntry>[2], "name"> & {
    title: string;
    usedIn: string;
    implementedIn: string;
    configurableIn?: string;
  }
> = {
  search_project: {
    title: "Buscar en el proyecto (extracción)",
    description:
      "Búsqueda semántica híbrida (RAG) en todo el proyecto indexado. Acepta 1–4 consultas descriptivas en español, no solo el título del elemento.",
    usedIn:
      "Pipeline híbrido de extracción: bucle LLM+tools en lib/project-extract-llm.ts cuando la estrategia del elemento es agente LLM.",
    implementedIn: "lib/project-extract-tools.ts → retrieveProjectChunksMulti",
    configurableIn:
      "Configuración → Evaluación → Extracción (maxToolIterations, toolSearchTopK, toolSearchMaxRetrievedChars)",
  },
  get_project_overview: {
    title: "Vista general del proyecto",
    description:
      "Lista archivos indexados, metadatos del índice y los primeros fragmentos RAG para orientar al agente antes de búsquedas más específicas.",
    usedIn: "Extracción LLM+tools al inicio del bucle o cuando el modelo necesita contexto global del proyecto.",
    implementedIn: "lib/project-extract-tools.ts",
  },
  get_structured_excel: {
    title: "Leer Excel estructurado",
    description:
      "Lee celdas de hojas Excel del proyecto con coordenadas (fila, columna). Opcionalmente filtra por archivo y hoja.",
    usedIn:
      "Extracción de elementos cuyo contenido está en hojas de cálculo (cronogramas, indicadores, tablas).",
    implementedIn: "lib/project-extract-tools.ts → formatExcelFile",
  },
  get_document_pages: {
    title: "Leer páginas de documento",
    description:
      "Lee páginas de PDF o secciones de Word, texto e imágenes del proyecto. Soporta rango de páginas y límite de caracteres.",
    usedIn:
      "Extracción de elementos en documentos narrativos (memorias, informes PDF/Word) cuando el RAG no basta.",
    implementedIn: "lib/project-extract-tools.ts → formatDocumentPages",
  },
};

function buildChatCategory(): AgentToolCategory {
  const tools = AGENT_TOOL_DEFINITIONS.map((def) => {
    const name = def.function.name;
    const meta = CHAT_TOOL_META[name];
    return toolEntry(
      `chat-${name}`,
      name,
      meta?.title ?? name,
      meta?.description ?? defDescription(def),
      formatSchema(def.function.parameters),
      "código",
      meta?.usedIn ?? "Chat agente (niveles B/C)",
      meta?.implementedIn ?? "lib/agent-tools.ts",
      meta?.configurableIn
    );
  });

  return {
    id: "chat-agent",
    title: "Chat — agente recopilador",
    description:
      "Herramientas del bucle tool-calling en niveles B y C del chat. El router de contexto (Nivel A) decide si activar el bucle y qué toolsHint sugerir.",
    tools,
  };
}

function buildExtractCategory(): AgentToolCategory {
  const tools = PROJECT_EXTRACT_TOOL_DEFINITIONS.map((def) => {
    const name = def.function.name;
    const meta = EXTRACT_TOOL_META[name];
    return toolEntry(
      `extract-${name}`,
      name,
      meta?.title ?? name,
      meta?.description ?? defDescription(def),
      formatSchema(def.function.parameters),
      "código",
      meta?.usedIn ?? "Extracción híbrida LLM+tools",
      meta?.implementedIn ?? "lib/project-extract-tools.ts",
      meta?.configurableIn
    );
  });

  return {
    id: "project-extract",
    title: "Extracción de elementos",
    description:
      "Herramientas del agente LLM que extrae cada elemento del proyecto cuando las heurísticas no bastan. Definidas en PROJECT_EXTRACT_TOOL_DEFINITIONS.",
    tools,
  };
}

export async function buildAgentToolsCatalog(): Promise<AgentToolsCatalogResponse> {
  return {
    generatedAt: new Date().toISOString(),
    categories: [buildChatCategory(), buildExtractCategory()],
  };
}
