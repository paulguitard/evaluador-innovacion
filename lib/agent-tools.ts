import { getConfig } from "@/lib/db";
import { hasActiveKnowledgeIndex, isKnowledgeConfigured } from "@/lib/knowledge-config";
import {
  retrieveRelevantChunks,
  retrieveRelevantChunksMulti,
  type RetrievedChunk,
} from "@/lib/rag-retrieve";
import { buildKnowledgeRagQueries } from "@/lib/rag-query-expand";
import { summarizeChunks } from "@/lib/agent-events";
import { getContextLimits } from "@/lib/rag-limits";
import { getEvaluationTypeSettings } from "@/lib/evaluation-type-settings-server";
import type { ContextPlan } from "@/lib/context-plan";
import type { ProjectStructuredData } from "@/lib/build-context";
import { searchProjectForQuery } from "@/lib/project-extract-tools";

export type AgentToolName =
  | "search_knowledge"
  | "search_project"
  | "get_rubric"
  | "get_config"
  | "get_project_elements"
  | "reextract_project_element";

export type AgentArtifacts = {
  knowledgeChunks: RetrievedChunk[];
  projectSearchSnippets: string[];
  rubricText?: string;
  configSections: Record<string, string>;
  projectElements: { element: string; content: string }[];
  toolLog: Array<{ tool: AgentToolName; summary: string }>;
};

export function createEmptyArtifacts(): AgentArtifacts {
  return {
    knowledgeChunks: [],
    projectSearchSnippets: [],
    configSections: {},
    projectElements: [],
    toolLog: [],
  };
}

export type AgentToolContext = {
  evaluationTypeId: number;
  plan: ContextPlan;
  sessionId?: string;
  projectFilePaths?: string[];
  projectElementsTable?: { element: string; content: string }[];
  projectStructuredData?: ProjectStructuredData;
};

export const AGENT_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description:
        "Busca fragmentos relevantes en el manual de referencia (Knowledge / RAG). Usar para preguntas sobre marco teórico, definiciones, Oslo.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Consulta de búsqueda en español o inglés" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_project",
      description:
        "Busca fragmentos relevantes en los archivos del proyecto subido (RAG de sesión). Usar para preguntas sobre el contenido del proyecto.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Consulta de búsqueda en español" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_rubric",
      description: "Obtiene la rúbrica y criterios de evaluación configurados.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_config",
      description: "Obtiene una sección de la configuración del tipo de evaluación.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["evaluation", "report_format", "elements", "summary"],
            description: "Sección a leer",
          },
        },
        required: ["section"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_project_elements",
      description:
        "Lee elementos extraídos del proyecto. Opcionalmente filtra por nombre de elemento.",
      parameters: {
        type: "object",
        properties: {
          element: {
            type: "string",
            description: "Nombre del elemento (opcional). Si se omite, devuelve todos.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reextract_project_element",
      description:
        "Reintenta extraer un elemento del proyecto cuando está vacío o incompleto (agente de extracción). Solo para casos difíciles.",
      parameters: {
        type: "object",
        properties: {
          element: {
            type: "string",
            description: "Título exacto del elemento a re-extraer",
          },
        },
        required: ["element"],
      },
    },
  },
];

function mergeChunks(existing: RetrievedChunk[], incoming: RetrievedChunk[]): RetrievedChunk[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  for (const c of incoming) {
    const prev = byId.get(c.id);
    if (!prev || c.score > prev.score) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext,
  artifacts: AgentArtifacts
): Promise<{ summary: string; ok: boolean }> {
  const tool = name as AgentToolName;

  switch (tool) {
    case "search_knowledge": {
      const query = typeof args.query === "string" ? args.query.trim() : ctx.plan.ragQuery;
      if (!(await isKnowledgeConfigured(ctx.evaluationTypeId))) {
        return { summary: "No hay Knowledge configurado para este tipo de evaluación.", ok: false };
      }
      if (!(await hasActiveKnowledgeIndex(ctx.evaluationTypeId))) {
        return { summary: "El índice RAG no está disponible. Reindexe el Knowledge.", ok: false };
      }
      const typeSettings = await getEvaluationTypeSettings(ctx.evaluationTypeId);
      const limits = getContextLimits(ctx.plan.ragMode, typeSettings.rag);
      const chapterQueries =
        ctx.plan.chapterNumbers && ctx.plan.chapterNumbers.length >= 2
          ? ctx.plan.chapterNumbers.map(
              (n) => `Manual Oslo Chapter ${n} capítulo ${n} ${query}`
            )
          : [];
      const queries =
        chapterQueries.length > 0
          ? [...new Set([...chapterQueries, ...buildKnowledgeRagQueries(query)])]
          : buildKnowledgeRagQueries(query);
      const chunks =
        queries.length > 1
          ? await retrieveRelevantChunksMulti(ctx.evaluationTypeId, queries, {
              topK: limits.topK,
              maxRetrievedChars: limits.maxRetrievedChars,
            })
          : await retrieveRelevantChunks(ctx.evaluationTypeId, query, {
              topK: limits.topK,
              maxRetrievedChars: limits.maxRetrievedChars,
            });
      artifacts.knowledgeChunks = mergeChunks(artifacts.knowledgeChunks, chunks);
      const { previews, totalChars } = summarizeChunks(chunks);
      const summary =
        chunks.length === 0
          ? "No se encontraron fragmentos para esta consulta."
          : `Recuperados ${chunks.length} fragmento(s) (${totalChars} caracteres). Primeros: ${previews
              .slice(0, 3)
              .map((p) => `${p.docName}${p.printedPage != null ? ` p.${p.printedPage}` : ""}`)
              .join("; ")}`;
      artifacts.toolLog.push({ tool, summary });
      return { summary, ok: chunks.length > 0 };
    }

    case "search_project": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const sessionId = ctx.sessionId ?? "default";
      if (!query) {
        return { summary: "Se requiere una consulta de búsqueda.", ok: false };
      }
      const text = await searchProjectForQuery(sessionId, query);
      if (!text.trim()) {
        return { summary: "No se encontraron fragmentos en el proyecto para esta consulta.", ok: false };
      }
      artifacts.projectSearchSnippets.push(text);
      const summary = `Fragmentos del proyecto (${text.length} caracteres): ${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`;
      artifacts.toolLog.push({ tool, summary: `Recuperados fragmentos del proyecto (${text.length} chars).` });
      return { summary, ok: true };
    }

    case "get_rubric": {
      const config = await getConfig(ctx.evaluationTypeId);
      const text = (config?.rubric_prompt ?? "").trim();
      if (!text) {
        return { summary: "No hay rúbrica configurada.", ok: false };
      }
      artifacts.rubricText = text;
      const summary = `Rúbrica obtenida (${text.length} caracteres).`;
      artifacts.toolLog.push({ tool, summary });
      return { summary, ok: true };
    }

    case "get_config": {
      const section = typeof args.section === "string" ? args.section : "summary";
      const config = await getConfig(ctx.evaluationTypeId);
      if (!config) return { summary: "Configuración no encontrada.", ok: false };
      let text = "";
      if (section === "evaluation") {
        text = [
          "La metodología de evaluación está programada en la aplicación.",
          "Parámetros configurables en §5 Evaluación (índice, knowledge, límites por fase).",
        ].join(" ");
      } else if (section === "report_format") {
        text = (config.report_format ?? "").trim();
      } else if (section === "elements") {
        text = config.elements ?? "[]";
      } else {
        text = [
          `Evaluación: metodología programada (§5 configurable)`,
          `Formato informe: ${(config.report_format ?? "").trim() || "vacío"}`,
          `Rúbrica: ${(config.rubric_prompt ?? "").trim() ? "configurada" : "no configurada"}`,
        ].join("\n");
      }
      artifacts.configSections[section] = text;
      const summary = `Configuración [${section}]: ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`;
      artifacts.toolLog.push({ tool, summary });
      return { summary, ok: !!text };
    }

    case "get_project_elements": {
      const table = ctx.projectElementsTable ?? [];
      if (table.length === 0) {
        return { summary: "No hay proyecto extraído.", ok: false };
      }
      const filter = typeof args.element === "string" ? args.element.trim().toLowerCase() : "";
      const rows = filter
        ? table.filter((r) => r.element.toLowerCase().includes(filter))
        : table;
      artifacts.projectElements = rows;
      const summary =
        rows.length === 0
          ? `Ningún elemento coincide con "${args.element}".`
          : `${rows.length} elemento(s): ${rows
              .slice(0, 5)
              .map((r) => r.element)
              .join(", ")}${rows.length > 5 ? "…" : ""}`;
      artifacts.toolLog.push({ tool, summary });
      return { summary, ok: rows.length > 0 };
    }

    case "reextract_project_element": {
      const elementTitle = typeof args.element === "string" ? args.element.trim() : "";
      const paths = ctx.projectFilePaths ?? [];
      if (!elementTitle) {
        return { summary: "Se requiere el nombre del elemento.", ok: false };
      }
      if (paths.length === 0) {
        return { summary: "No hay archivos del proyecto para re-extraer.", ok: false };
      }
      const { retryExtractElement } = await import("@/lib/project-extract-pipeline");
      const result = await retryExtractElement({
        sessionId: ctx.sessionId ?? "default",
        evaluationTypeId: ctx.evaluationTypeId,
        projectFilePaths: paths,
        elementTitle,
      });
      if (result.content.trim()) {
        const table = [...(ctx.projectElementsTable ?? [])];
        const idx = table.findIndex((r) => r.element === result.element);
        const row = { element: result.element, content: result.content };
        if (idx >= 0) table[idx] = row;
        else table.push(row);
        artifacts.projectElements = table;
        ctx.projectElementsTable = table;
      }
      const summary = result.content.trim()
        ? `Re-extraído "${result.element}" (${result.content.length} caracteres).`
        : `No se encontró contenido para "${elementTitle}".`;
      artifacts.toolLog.push({ tool, summary });
      return { summary, ok: !!result.content.trim() };
    }

    default:
      return { summary: `Herramienta desconocida: ${name}`, ok: false };
  }
}

/** Ejecuta herramientas sugeridas por el plan cuando el bucle LLM no está disponible. */
export async function runPlannedTools(
  ctx: AgentToolContext,
  artifacts: AgentArtifacts
): Promise<void> {
  const hints = ctx.plan.toolsHint;
  for (const hint of hints) {
    if (hint === "search_knowledge" && ctx.plan.sources.includes("knowledge_rag")) {
      await executeAgentTool("search_knowledge", { query: ctx.plan.ragQuery }, ctx, artifacts);
    }
    if (hint === "search_project" && ctx.plan.sources.includes("project")) {
      await executeAgentTool("search_project", { query: ctx.plan.ragQuery }, ctx, artifacts);
    }
    if (hint === "get_rubric" && ctx.plan.sources.includes("rubric")) {
      await executeAgentTool("get_rubric", {}, ctx, artifacts);
    }
    if (hint === "get_project_elements" && ctx.plan.sources.includes("project")) {
      await executeAgentTool("get_project_elements", {}, ctx, artifacts);
    }
    if (hint === "reextract_project_element") {
      const emptyRows = (ctx.projectElementsTable ?? []).filter((r) => !r.content.trim());
      for (const empty of emptyRows) {
        await executeAgentTool(
          "reextract_project_element",
          { element: empty.element },
          ctx,
          artifacts
        );
      }
    }
    if (hint === "get_config") {
      await executeAgentTool("get_config", { section: "summary" }, ctx, artifacts);
    }
  }
}
