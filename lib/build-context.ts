import { getConfig } from "@/lib/db";
import { extractTextFromFile } from "@/lib/document-parser";
import { getKnowledgeDocuments } from "@/lib/knowledge-loader";
import { hasActiveKnowledgeIndex, isKnowledgeConfigured } from "@/lib/knowledge-config";
import {
  retrieveRelevantChunks,
  retrieveRelevantChunksMulti,
  type RetrievedChunk,
} from "@/lib/rag-retrieve";
import { buildKnowledgeRagQueries } from "@/lib/rag-query-expand";
import { retrieveChunksForPrintedPage } from "@/lib/page-lookup";
import {
  getChapterContextForEvaluation,
  buildMultiChapterComparisonContext,
} from "@/lib/chapter-lookup";
import {
  getContextLimits,
  getRagQueryLimits,
  applyEvaluateRagOverrides,
  type ContextMode,
} from "@/lib/rag-limits";
import { getEvaluationTypeSettings } from "@/lib/evaluation-type-settings-server";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import { loadChatAgentConfig } from "@/lib/chat-agent-config-server";
import { summarizeChunks, type BuildContextStreamEvent } from "@/lib/agent-events";
import { includesSource, type ContextPlan } from "@/lib/context-plan";
import type { AgentArtifacts } from "@/lib/agent-tools";
import { mergeRubricConfig, compileRubricToLegacyText } from "@/lib/rubric-config";
import { isReportFormatValid, mergeReportFormatConfig, compileReportFormatToLegacyText } from "@/lib/report-format-config";
import path from "path";
import fs from "fs";

const MAX_PROJECT_SECTION_CHARS = 18_000;
const MAX_STRUCTURED_SUMMARY_CHARS = 16_000;

function extractObjectivesAndRest(text: string): { block: string | null; rest: string } {
  const gen = /OBJETIVO\s+GENERAL\s*:?\s*/i;
  const esp = /OBJETIVOS\s+ESPECÍFICOS\s*:?\s*/i;
  const idxGen = text.search(gen);
  const idxEsp = text.search(esp);
  const start = Math.min(idxGen >= 0 ? idxGen : 1e9, idxEsp >= 0 ? idxEsp : 1e9);
  if (start >= 1e9) return { block: null, rest: text };
  const blockLen = 3200;
  const block = text.slice(start, start + blockLen).trim() || null;
  const rest = (text.slice(0, start).trim() + "\n\n" + text.slice(start + blockLen).trim()).trim();
  return { block, rest };
}

export type ProjectStructuredData = {
  files: Array<{
    fileName: string;
    sheets: Array<{
      sheetName: string;
      cells: Array<{ row: number; col: number; value: string }>;
    }>;
  }>;
};

function formatStructuredDataSummary(data: ProjectStructuredData, maxChars: number): string {
  const parts: string[] = [];
  for (const file of data.files ?? []) {
    parts.push(`### Archivo: ${file.fileName}`);
    for (const sheet of file.sheets ?? []) {
      parts.push(`\n#### Hoja: ${sheet.sheetName}\n`);
      const cells = (sheet.cells ?? []).slice();
      cells.sort((a, b) => a.row - b.row || a.col - b.col);
      for (const c of cells) {
        parts.push(`(fila ${c.row}, col ${c.col}): ${String(c.value ?? "").trim()}\n`);
      }
    }
  }
  const out = parts.join("");
  return out.length > maxChars ? out.slice(0, maxChars) + "\n\n[Contenido truncado por límite de longitud.]" : out;
}

export type BuildSystemContextOptions = {
  projectElementsTable?: { element: string; content: string }[];
  projectStructuredData?: ProjectStructuredData;
  skipKnowledge?: boolean;
  projectElementsOnly?: boolean;
  excludeReportFormat?: boolean;
  /** Modo de límites RAG y contexto. */
  contextMode?: ContextMode;
  /** Query para recuperación RAG (pregunta del usuario o dimensión de evaluación). */
  ragQuery?: string;
  excludeChunkIds?: Set<string>;
  pageNumber?: number;
  chapterNumber?: number;
  chapterNumbers?: number[];
  /** En evaluación multi-dimensión: enfoque en una sola dimensión. */
  evaluateDimension?: { name: string; content: string };
  /** En evaluación por subdimensión: enfoque en un solo subcriterio. */
  evaluateSubdimension?: { dimensionName: string; name: string; content: string };
  /** Callback con chunks recuperados (p. ej. deduplicación en evaluación). */
  onRetrievedChunks?: (chunks: RetrievedChunk[]) => void;
  /** Emite pasos observables durante la construcción del contexto (chat). */
  onStreamEvent?: (event: BuildContextStreamEvent) => void;
  /** Caracteres adicionales inyectados fuera de buildSystemContext (p. ej. evaluación masiva). */
  supplementalContextChars?: number;
  /** Plan del agente (chat): qué secciones incluir en el prompt. */
  contextPlan?: ContextPlan;
  /** Datos recopilados por herramientas del agente (Nivel B/C). */
  agentArtifacts?: AgentArtifacts;
  /** En evaluate: fallar si el contexto superaría maxSystemChars en lugar de truncar. */
  strictEvaluate?: boolean;
};

function buildDefaultRagQuery(
  knowledgeLabel: string,
  rubricText: string,
  queryLimits: { ragQueryPromptChars: number; ragQueryRubricChars: number },
  extra?: string
): string {
  return [
    knowledgeLabel.slice(0, queryLimits.ragQueryPromptChars),
    rubricText.slice(0, queryLimits.ragQueryRubricChars),
    extra ?? `Evaluar proyecto según rúbrica y documentación de referencia (${knowledgeLabel}).`,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function formatKnowledgeChunks(
  chunks: Array<{ docName: string; text: string; page?: number; printedPage?: number }>
): string {
  return chunks
    .map((c) => {
      const pageLabel =
        c.printedPage != null
          ? ` (página impresa ${c.printedPage})`
          : c.page != null
            ? ` (pág. PDF ${c.page})`
            : "";
      return `### Documento: ${c.docName}${pageLabel}\n\n${c.text}`;
    })
    .join("\n\n---\n\n");
}

function emitContextEvent(
  options: BuildSystemContextOptions | undefined,
  event: BuildContextStreamEvent
): void {
  options?.onStreamEvent?.(event);
}

export async function buildSystemContext(
  evaluationTypeId: number,
  projectFilePaths: string[] = [],
  options?: BuildSystemContextOptions
): Promise<string> {
  const config = await getConfig(evaluationTypeId);
  if (!config) return "";

  const typeSettings = await getEvaluationTypeSettings(evaluationTypeId);
  const evaluationConfig = await getEvaluationConfig(evaluationTypeId);
  const chatAgentConfig = await loadChatAgentConfig();
  const queryLimits = getRagQueryLimits(typeSettings.rag);

  emitContextEvent(options, {
    type: "step",
    phase: "context",
    message: "Construyendo contexto para el modelo…",
  });

  const mode: ContextMode = options?.contextMode ?? "chat-project";
  let limits = getContextLimits(mode, typeSettings.rag);
  if (mode === "evaluate") {
    limits = applyEvaluateRagOverrides(limits, evaluationConfig.ragEvaluate);
  }
  const maxSystemChars = limits.maxSystemChars;
  const knowledgeConfigured = await isKnowledgeConfigured(evaluationTypeId);
  const knowledgeIndexReady = knowledgeConfigured && (await hasActiveKnowledgeIndex(evaluationTypeId));

  if (
    !options?.skipKnowledge &&
    !knowledgeConfigured &&
    (mode === "chat-knowledge" || mode === "chat-chapter")
  ) {
    emitContextEvent(options, {
      type: "chunks_empty",
      message: "No hay documentos en Knowledge para este tipo de evaluación.",
    });
    return [
      "## Sin documentos de referencia para este tipo de evaluación",
      "",
      "No hay archivos en Knowledge configurados para este tipo de evaluación (p. ej. TRL vs IGIP).",
      "Indica al usuario que suba documentos en Configuración → Knowledge **para el tipo de evaluación activo**.",
      "PROHIBIDO usar contenido del manual u otro knowledge de otro tipo de evaluación. No inventes respuestas.",
    ].join("\n");
  }
  const pageLookup =
    options?.pageNumber != null &&
    !options?.skipKnowledge &&
    (mode === "chat-knowledge" || mode === "chat-project" || mode === "chat-chapter");

  const comparisonChapters =
    options?.contextPlan?.chapterNumbers ??
    (options?.chapterNumbers && options.chapterNumbers.length >= 2
      ? options.chapterNumbers
      : undefined);
  const comparisonMode =
    options?.contextPlan?.comparisonMode === true ||
    (comparisonChapters != null && comparisonChapters.length >= 2);

  const chapterLookup =
    !comparisonMode &&
    options?.chapterNumber != null &&
    options?.pageNumber == null &&
    !options?.skipKnowledge &&
    (mode === "chat-chapter" || mode === "chat-knowledge" || mode === "chat-project");

  // Comparación multi-capítulo (p. ej. cap. 2 definición vs cap. 4 medición).
  if (comparisonMode && comparisonChapters && comparisonChapters.length >= 2 && knowledgeIndexReady) {
    const chLabel = comparisonChapters.join(" y ");
    emitContextEvent(options, {
      type: "step",
      phase: "rag",
      message: `Recuperando fragmentos de los capítulos ${chLabel} para comparación…`,
    });
    const multi = await buildMultiChapterComparisonContext(
      evaluationTypeId,
      comparisonChapters,
      limits.maxRetrievedChars
    );
    if (multi && multi.chunks.length > 0) {
      options?.onRetrievedChunks?.(multi.chunks);
      const { previews, totalChars } = summarizeChunks(multi.chunks);
      emitContextEvent(options, {
        type: "chunks",
        count: multi.chunks.length,
        totalChars,
        chunks: previews,
      });
      emitContextEvent(options, {
        type: "context_section",
        section: `Capítulos ${chLabel}`,
        detail: `${multi.chunks.length} fragmento(s) para comparación (${totalChars.toLocaleString("es")} caracteres)`,
      });
      return multi.text;
    }
    emitContextEvent(options, {
      type: "chunks_empty",
      message: `No se encontraron fragmentos de los capítulos ${chLabel}.`,
    });
    return [
      `## Comparación de capítulos ${chLabel}`,
      "",
      "No se encontraron fragmentos indexados de esos capítulos.",
      "Indica al usuario que verifique los números e intente reindexar el Knowledge.",
    ].join("\n");
  }

  // Modo capítulo único: fragmentos contiguos (resumen por secciones del índice).
  if (chapterLookup && knowledgeIndexReady) {
    const targetChapter = options!.chapterNumber!;
    emitContextEvent(options, {
      type: "step",
      phase: "rag",
      message: `Buscando fragmentos del Capítulo ${targetChapter} en el manual indexado…`,
    });
    const chapterCtx = await getChapterContextForEvaluation(
      evaluationTypeId,
      targetChapter,
      limits.maxRetrievedChars
    );
    if (chapterCtx && chapterCtx.chunks.length > 0) {
      options?.onRetrievedChunks?.(chapterCtx.chunks);
      const { previews, totalChars } = summarizeChunks(chapterCtx.chunks);
      emitContextEvent(options, {
        type: "chunks",
        count: chapterCtx.chunks.length,
        totalChars,
        chunks: previews,
      });
      emitContextEvent(options, {
        type: "context_section",
        section: "Capítulo del manual",
        detail: `${chapterCtx.chunks.length} fragmento(s) del capítulo ${targetChapter} (${totalChars.toLocaleString("es")} caracteres)`,
      });
      return [
        `## Capítulo ${targetChapter} del manual de referencia`,
        "",
        chapterCtx.rules,
        "",
        "## Texto del capítulo (fragmentos indexados)",
        "",
        `REGLA: Sigue el «Formato obligatorio de la respuesta» e incluye todas las secciones del índice con encabezado y párrafo propios. No omitas secciones ni uses solo la etiqueta «resumen anticipado». ${chatAgentConfig.contextHardRules.chapterComparisonNoRubric} No inventes contenido.`,
        "",
        formatKnowledgeChunks(chapterCtx.chunks),
      ].join("\n");
    }
    emitContextEvent(options, {
      type: "chunks_empty",
      message: `No se encontraron fragmentos del Capítulo ${targetChapter} en el índice.`,
    });
    return [
      `## Capítulo ${targetChapter} del manual`,
      "",
      `No se encontraron fragmentos indexados del Capítulo ${targetChapter}.`,
      "Indica al usuario que verifique el número de capítulo e intente reindexar el knowledge si el manual fue actualizado.",
      "No inventes ni uses la rúbrica de evaluación para responder.",
    ].join("\n");
  }

  // Modo página: solo fragmentos del manual para esa página (sin rúbrica ni instrucciones).
  if (pageLookup && knowledgeIndexReady) {
    const targetPage = options!.pageNumber!;
    emitContextEvent(options, {
      type: "step",
      phase: "rag",
      message: `Buscando contenido de la página ${targetPage} en el manual indexado…`,
    });
    const pageChunks = await retrieveChunksForPrintedPage(
      evaluationTypeId,
      targetPage,
      limits.maxRetrievedChars
    );
    if (pageChunks.length > 0) {
      options?.onRetrievedChunks?.(pageChunks);
      const { previews, totalChars } = summarizeChunks(pageChunks);
      emitContextEvent(options, {
        type: "chunks",
        count: pageChunks.length,
        totalChars,
        chunks: previews,
      });
      emitContextEvent(options, {
        type: "context_section",
        section: "Página del manual",
        detail: `${pageChunks.length} fragmento(s) de la página ${targetPage} (${totalChars.toLocaleString("es")} caracteres)`,
      });
      return [
        `## Contenido de la página ${targetPage} del manual de referencia`,
        "",
        chatAgentConfig.contextHardRules.buildContextNoRubric,
        "",
        formatKnowledgeChunks(pageChunks),
      ].join("\n");
    }
    emitContextEvent(options, {
      type: "chunks_empty",
      message: `No se encontraron fragmentos de la página ${targetPage} en el índice.`,
    });
    return [
      `## Página ${targetPage} del manual`,
      "",
      `No se encontraron fragmentos indexados con el contenido de la página impresa ${targetPage}.`,
      "Indica al usuario que verifique el número de página impresa (en el PDF puede diferir del número del visor).",
      "No inventes ni uses la rúbrica de evaluación para responder.",
    ].join("\n");
  }

  const parts: string[] = [];

  const knowledgeLabel = evaluationConfig.knowledgeReferenceLabel;
  let reportFormat = (config.report_format ?? "").trim();
  let rubricText = (config.rubric_prompt ?? "").trim();
  try {
    const rubricConfig = mergeRubricConfig(JSON.parse(config.rubric_config || "{}"));
    const compiled = compileRubricToLegacyText(rubricConfig).trim();
    if (compiled) rubricText = compiled;
    const reportConfig = mergeReportFormatConfig(
      JSON.parse(config.report_format_config || "{}"),
      rubricConfig
    );
    if (isReportFormatValid(reportConfig, rubricConfig)) {
      reportFormat = compileReportFormatToLegacyText(reportConfig, rubricConfig);
    }
  } catch {
    /* mantener texto legacy */
  }

  const elementsRaw = config.elements ?? "[]";
  let elementsList: { title?: string; description?: string; section?: string }[] = [];
  try {
    elementsList = JSON.parse(elementsRaw) as { title?: string; description?: string; section?: string }[];
    if (!Array.isArray(elementsList)) elementsList = [];
  } catch {
    elementsList = [];
  }
  const elementsBySection = elementsList.reduce(
    (acc, el) => {
      const section = (el.section ?? "General").trim() || "General";
      if (!acc[section]) acc[section] = [];
      acc[section].push({ title: el.title ?? "", description: el.description ?? "" });
      return acc;
    },
    {} as Record<string, { title: string; description: string }[]>
  );
  const elementsConfigText =
    Object.keys(elementsBySection).length === 0
      ? "Ninguno configurado."
      : Object.entries(elementsBySection)
          .map(
            ([sec, items]) =>
              `**${sec}:**\n` +
              items.map((e) => `- ${e.title || "(sin nombre)"}${e.description ? `: ${e.description}` : ""}`).join("\n")
          )
          .join("\n\n");

  const includeFormatInSummary = !options?.excludeReportFormat;
  const configSummary = [
    "**Metodología de evaluación:**",
    "Programada en la aplicación: extraer elementos del proyecto → evaluar por dimensión/subdimensión según rúbrica → fundamentar con Knowledge → generar informe según formato configurado.",
    "",
    ...(includeFormatInSummary
      ? ["**Formato del informe:**", reportFormat ? reportFormat : "Vacío. No hay formato de informe configurado.", ""]
      : []),
    ...(includeFormatInSummary
      ? [
          "**Rúbrica:**",
          rubricText ? "Configurada (ver sección 'Rúbrica y criterios de evaluación' más abajo)." : "No configurada.",
          "",
        ]
      : []),
    "**Elementos a identificar en el proyecto** (lo que se extrae y se muestra en 'Proyecto extraído'):",
    elementsConfigText,
    "",
    `**Parámetros de evaluación (§5):** índice ${evaluationConfig.indicatorLabel}, knowledge «${knowledgeLabel}».`,
    "",
    "REGLA: Si el usuario pregunta por la configuración, el formato del informe o los elementos a identificar, responde ÚNICAMENTE con lo indicado en esta sección. No confundas rúbrica con formato. No inventes pasos ni criterios a partir del manual de referencia.",
  ].join("\n");

  const plan = options?.contextPlan;

  if (!plan || includesSource(plan, "config_summary")) {
    parts.push("## Configuración actual de este tipo de evaluación\n\n" + configSummary);
    emitContextEvent(options, {
      type: "context_section",
      section: "Configuración",
      detail: "Configuración, formato, elementos y estado de la rúbrica",
    });
  } else {
    emitContextEvent(options, {
      type: "context_section",
      section: "Configuración",
      detail: "Omitida por decisión del agente planificador",
    });
  }

  if (options?.evaluateSubdimension) {
    parts.push(
      `## Enfoque de esta evaluación parcial\n\nEvalúa ÚNICAMENTE la subdimensión **${options.evaluateSubdimension.name}** (dimensión **${options.evaluateSubdimension.dimensionName}**). Fundamenta el análisis en los fragmentos de **${knowledgeLabel}** (Knowledge) incluidos abajo y en los datos del proyecto.\n\n### Criterios de esta subdimensión\n\n${options.evaluateSubdimension.content}`
    );
  } else if (options?.evaluateDimension) {
    parts.push(
      `## Enfoque de esta evaluación parcial\n\nEvalúa ÚNICAMENTE la dimensión **${options.evaluateDimension.name}**. Fundamenta el análisis en los fragmentos de **${knowledgeLabel}** (Knowledge) incluidos abajo y en los datos del proyecto.\n\n### Criterios de esta dimensión\n\n${options.evaluateDimension.content}`
    );
  }

  if (
    reportFormat &&
    !options?.excludeReportFormat &&
    (!plan || includesSource(plan, "report_format"))
  ) {
    parts.push("## Formato del informe\n\n" + reportFormat);
  }

  const artifactProject = options?.agentArtifacts?.projectElements ?? [];
  const bulkSnippets = options?.agentArtifacts?.bulkProjectSnippets ?? [];
  if (bulkSnippets.length > 0) {
    parts.push(
      "## Datos de proyectos evaluados (recopilados por herramientas)\n\n" +
        bulkSnippets.join("\n\n---\n\n")
    );
    emitContextEvent(options, {
      type: "context_section",
      section: "Proyectos masivos",
      detail: `${bulkSnippets.length} fragmento(s) de proyectos evaluados`,
    });
  }
  const projectElementsTable =
    artifactProject.length > 0
      ? artifactProject
      : options?.projectElementsTable;
  if (
    projectElementsTable &&
    projectElementsTable.length > 0 &&
    (!plan || includesSource(plan, "project"))
  ) {
    const tableText = projectElementsTable
      .map((r) => `**${r.element}:**\n${r.content}`)
      .join("\n\n");
    parts.push("## Documentos del proyecto a evaluar (elementos identificados)\n\n" + tableText);
    emitContextEvent(options, {
      type: "context_section",
      section: "Proyecto",
      detail: `${projectElementsTable.length} elemento(s) identificado(s) del proyecto`,
    });
  }
  if (
    options?.projectStructuredData?.files?.length &&
    (!plan || includesSource(plan, "project_structured"))
  ) {
    const summary = formatStructuredDataSummary(options.projectStructuredData, MAX_STRUCTURED_SUMMARY_CHARS);
    parts.push(
      "## Datos completos del documento (todas las hojas)\n\nUsa esta sección para responder preguntas sobre cualquier hoja del archivo (por ejemplo plan de actividades, Gantt, presupuesto, indicadores). Contiene el contenido de todas las hojas extraídas.\n\n" +
        summary
    );
    const sheetCount = options.projectStructuredData.files.reduce(
      (n, f) => n + (f.sheets?.length ?? 0),
      0
    );
    emitContextEvent(options, {
      type: "context_section",
      section: "Excel estructurado",
      detail: `${options.projectStructuredData.files.length} archivo(s), ${sheetCount} hoja(s)`,
    });
  }
  if (!projectElementsTable?.length && !options?.projectStructuredData?.files?.length && !options?.projectElementsOnly && projectFilePaths.length > 0) {
    const projectTexts: string[] = [];
    for (const filePath of projectFilePaths) {
      if (!fs.existsSync(filePath)) continue;
      const text = await extractTextFromFile(filePath);
      if (!text) continue;
      const { block: objectivesBlock, rest } = extractObjectivesAndRest(text);
      const restMax = MAX_PROJECT_SECTION_CHARS - (objectivesBlock?.length ?? 0) - 200;
      const restTruncated =
        rest.length > restMax ? rest.slice(0, restMax) + "\n\n[Contenido truncado…]" : rest;
      const display =
        objectivesBlock != null
          ? `### Archivo: ${path.basename(filePath)}\n\n**Objetivos (texto del documento):**\n\n${objectivesBlock}\n\n---\n\n**Resto del contenido:**\n\n${restTruncated}`
          : `### Archivo: ${path.basename(filePath)}\n\n${restTruncated}`;
      projectTexts.push(display);
    }
    if (projectTexts.length > 0) {
      parts.push("## Documentos del proyecto a evaluar\n\n" + projectTexts.join("\n\n---\n\n"));
    }
  }

  const rubricSectionText = rubricText
    ? rubricText
    : `No hay rúbrica de evaluación configurada para este tipo de evaluación.

REGLA para preguntas sobre rúbrica o criterios: Responde únicamente que no hay rúbrica definida en la configuración actual.`;

  const skipKnowledge =
    options?.skipKnowledge === true ||
    limits.skipKnowledge ||
    (plan != null && !includesSource(plan, "knowledge_rag"));

  const artifactChunks = options?.agentArtifacts?.knowledgeChunks ?? [];
  if (artifactChunks.length > 0) {
    const { previews, totalChars } = summarizeChunks(artifactChunks);
    emitContextEvent(options, {
      type: "chunks",
      count: artifactChunks.length,
      totalChars,
      chunks: previews,
    });
    emitContextEvent(options, {
      type: "context_section",
      section: "Knowledge (agente)",
      detail: `${artifactChunks.length} fragmento(s) recopilados por herramientas del agente`,
    });
    parts.push(
      "## Documentación de referencia (Knowledge)\n\n" +
        "REGLA: Fundamenta la respuesta en estos fragmentos recopilados por el agente.\n\n" +
        formatKnowledgeChunks(artifactChunks)
    );
  }

  if (!skipKnowledge && knowledgeIndexReady && artifactChunks.length === 0) {
    try {
      const ragQuery =
        options?.ragQuery?.trim() ||
        buildDefaultRagQuery(knowledgeLabel, rubricText, queryLimits);
      const ragQueries =
        mode === "chat-knowledge" ? buildKnowledgeRagQueries(ragQuery) : undefined;

      emitContextEvent(options, {
        type: "step",
        phase: "rag",
        message:
          mode === "chat-knowledge"
            ? "Buscando en Knowledge (búsqueda híbrida ampliada)…"
            : "Buscando fragmentos relevantes en Knowledge (embeddings + keywords)…",
      });
      emitContextEvent(options, {
        type: "rag_query",
        query: ragQuery,
        queries: ragQueries,
      });

      const chunks =
        mode === "chat-knowledge" && ragQueries
          ? await retrieveRelevantChunksMulti(evaluationTypeId, ragQueries, {
              topK: limits.topK,
              maxRetrievedChars: limits.maxRetrievedChars,
              excludeIds: options?.excludeChunkIds,
              pageNumber: options?.pageNumber,
            })
          : await retrieveRelevantChunks(evaluationTypeId, ragQuery, {
              topK: limits.topK,
              maxRetrievedChars: limits.maxRetrievedChars,
              excludeIds: options?.excludeChunkIds,
              pageNumber: options?.pageNumber,
            });
      if (chunks.length > 0) {
        options?.onRetrievedChunks?.(chunks);
        const { previews, totalChars } = summarizeChunks(chunks);
        emitContextEvent(options, {
          type: "chunks",
          count: chunks.length,
          totalChars,
          chunks: previews,
        });
        emitContextEvent(options, {
          type: "context_section",
          section: "Knowledge (RAG)",
          detail: `${chunks.length} fragmento(s) recuperado(s), ${totalChars.toLocaleString("es")} caracteres para el contexto`,
        });
        const strictKnowledge =
          mode === "chat-knowledge"
            ? "REGLA: Extrae con el máximo detalle posible lo que aparece en estos fragmentos (definiciones, encuestas, métodos, pasos). No inventes tablas ni páginas. Si los fragmentos son parciales, resume primero lo disponible y solo después indica qué aspecto no figura en ellos.\n\n"
            : "REGLA: Fundamenta tu respuesta en estos fragmentos del manual de referencia cuando sea pertinente. Cita conceptos del marco teórico cuando apliquen.\n\n";
        const knowledgeSection =
          "## Documentación de referencia (Knowledge)\n\n" +
          strictKnowledge +
          formatKnowledgeChunks(chunks);
        parts.push(knowledgeSection);
      } else {
        emitContextEvent(options, {
          type: "chunks_empty",
          message: "La búsqueda en el índice no devolvió fragmentos para esta consulta.",
        });
      }
    } catch {
      emitContextEvent(options, {
        type: "step",
        phase: "rag",
        message: "Error en la búsqueda RAG; intentando cargar documentos completos…",
      });
    }
  } else if (skipKnowledge) {
    emitContextEvent(options, {
      type: "context_section",
      section: "Knowledge",
      detail: "Omitido para esta pregunta (modo configuración o sin índice)",
    });
  } else if (!knowledgeIndexReady && knowledgeConfigured) {
    emitContextEvent(options, {
      type: "step",
      phase: "rag",
      message: "Índice RAG no disponible; se usará texto completo de Knowledge si existe.",
    });
  }

  if (!skipKnowledge && !parts.some((p) => p.startsWith("## Documentación de referencia"))) {
    const docs = await getKnowledgeDocuments(evaluationTypeId);
    if (docs.length > 0) {
      emitContextEvent(options, {
        type: "step",
        phase: "rag",
        message: `Cargando ${docs.length} documento(s) de Knowledge sin búsqueda vectorial (respaldo)…`,
      });
      const maxFallback = Math.min(40_000, limits.maxRetrievedChars * 2);
      const knowledgeTexts = docs.map((d) => {
        const t = d.text.length > maxFallback ? d.text.slice(0, maxFallback) + "\n[…truncado]" : d.text;
        return `### Documento: ${d.docName}\n\n${t}`;
      });
      parts.push("## Documentación de referencia (Knowledge)\n\n" + knowledgeTexts.join("\n\n---\n\n"));
    }
  }

  const rubricFromArtifacts = options?.agentArtifacts?.rubricText?.trim();
  const rubricBody = rubricFromArtifacts || rubricSectionText;
  const includeRubric =
    !!rubricFromArtifacts || !plan || includesSource(plan, "rubric");

  if (includeRubric) {
    parts.push("## Rúbrica y criterios de evaluación\n\n" + rubricBody);
    emitContextEvent(options, {
      type: "context_section",
      section: "Rúbrica",
      detail: rubricBody.includes("No hay rúbrica")
        ? "Sin rúbrica configurada"
        : rubricFromArtifacts
          ? "Rúbrica recopilada por herramienta del agente"
          : "Rúbrica configurada incluida en el contexto",
    });
  } else {
    emitContextEvent(options, {
      type: "context_section",
      section: "Rúbrica",
      detail: "Omitida por decisión del agente planificador",
    });
  }

  const configArtifacts = options?.agentArtifacts?.configSections ?? {};
  const configArtifactKeys = Object.keys(configArtifacts);
  if (configArtifactKeys.length > 0) {
    const lines = configArtifactKeys.map(
      (k) => `### ${k}\n\n${configArtifacts[k]}`
    );
    parts.push("## Configuración (recopilada por agente)\n\n" + lines.join("\n\n"));
  }

  const separator = "\n\n---\n\n";
  const promptPart = parts.find((p) => p.startsWith("## Instrucciones de evaluación"));
  const reportFormatPart = parts.find((p) => p.startsWith("## Formato del informe"));
  const projectPart = parts.find((p) => p.startsWith("## Documentos del proyecto"));
  const knowledgePart = parts.find((p) => p.startsWith("## Documentación de referencia"));
  const rubricPart = parts.find((p) => p.startsWith("## Rúbrica"));
  const focusPart = parts.find((p) => p.startsWith("## Enfoque de esta evaluación"));

  const otherLen =
    (promptPart?.length ?? 0) +
    (reportFormatPart?.length ?? 0) +
    (rubricPart?.length ?? 0) +
    (projectPart?.length ?? 0) +
    (focusPart?.length ?? 0) +
    separator.length * Math.max(0, parts.length - 1);
  const truncationNotice = "\n\n[Documentación de referencia truncada por límite de longitud.]";
  if (knowledgePart && otherLen + knowledgePart.length + truncationNotice.length > maxSystemChars) {
    if (options?.strictEvaluate) {
      throw new Error(
        `El contexto de evaluación supera maxSystemChars (${maxSystemChars.toLocaleString("es")}): la sección Knowledge no cabe completa. Aumente «System max chars» en RAG de evaluación.`
      );
    }
    const maxKnowledgeLen = maxSystemChars - otherLen - truncationNotice.length;
    if (maxKnowledgeLen > 0) {
      const idx = parts.indexOf(knowledgePart);
      parts[idx] = knowledgePart.slice(0, maxKnowledgeLen) + truncationNotice;
    }
  }

  let fullContext = parts.join(separator);
  const truncationSuffix = "\n\n[Contexto truncado por límite de longitud.]";
  if (fullContext.length > maxSystemChars) {
    if (options?.strictEvaluate) {
      throw new Error(
        `El contexto de evaluación (${fullContext.length.toLocaleString("es")} caracteres) supera maxSystemChars (${maxSystemChars.toLocaleString("es")}). Aumente «System max chars» en RAG de evaluación o reduzca rúbrica/elementos.`
      );
    }
    fullContext = fullContext.slice(0, maxSystemChars - truncationSuffix.length) + truncationSuffix;
    emitContextEvent(options, {
      type: "step",
      phase: "context",
      message: `Contexto truncado al límite de ${maxSystemChars.toLocaleString("es")} caracteres.`,
    });
  }

  const supplemental = options?.supplementalContextChars ?? 0;
  const contextMessage =
    supplemental > 0
      ? `Contexto listo (${fullContext.length.toLocaleString("es")} caracteres de fuentes + ${supplemental.toLocaleString("es")} de evaluación masiva = ${(fullContext.length + supplemental).toLocaleString("es")} para el system prompt).`
      : `Contexto listo (${fullContext.length.toLocaleString("es")} caracteres para el system prompt).`;
  emitContextEvent(options, {
    type: "step",
    phase: "context",
    message: contextMessage,
  });

  return fullContext;
}
