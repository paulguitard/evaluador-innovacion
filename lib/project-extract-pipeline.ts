import path from "path";
import fs from "fs";

import { getConfig, getEvaluationTypeById } from "@/lib/db";
import { extractTextFromFile } from "@/lib/document-parser";
import { extractTextWithVision } from "@/lib/extract-with-vision";
import type { ElementExtractStrategy } from "@/lib/evaluation-type-settings";
import type { ElementDef } from "@/lib/excel-heuristics";
import { ingestProjectFiles } from "@/lib/project-ingest";
import { extractElementHybrid } from "@/lib/project-extract-hybrid";
import { getEvaluationTypeSettings } from "@/lib/evaluation-type-settings-server";
import {
  buildDuplicateRetryHint,
  findDuplicateContentGroups,
} from "@/lib/extract-duplicate-guard";
import { looksLikeContinuityAnswer } from "@/lib/extract-content-clean";
import { isFactorInnovadorElement } from "@/lib/form-row-extract";
import { loadProjectStructuredIndex } from "@/lib/project-structured-index";
import { projectIndexMatches } from "@/lib/project-vector-store";
import { markIncompleteRows } from "@/lib/project-extract-validate";
import type { ProjectStructuredData } from "@/lib/build-context";
import { setExtractRunContext } from "@/lib/extract-run-context";

export type ElementRow = {
  section: string;
  element: string;
  content: string;
  incomplete?: boolean;
};

export type ExtractStreamEvent =
  | { type: "step"; message: string }
  | { type: "element"; name: string; method?: string }
  | {
      type: "done";
      text: string;
      structuredData?: ProjectStructuredData | { source: string; elements: { element: string; content: string }[] };
      elementsTable?: ElementRow[];
    }
  | { type: "error"; error: string };

const LIBRARY_EXTS = [".pdf", ".xlsx", ".xls", ".docx", ".doc"];
const VISION_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

const ELEMENT_TIMEOUT_MS = 45_000;

function parseConfigElements(raw: unknown): ElementDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is ElementDef => typeof e === "object" && e != null && "title" in e && "description" in e)
    .map((e) => {
      const def: ElementDef = {
        title: String(e.title),
        description: String(e.description ?? ""),
        section: typeof e.section === "string" ? e.section : "General",
      };
      if (e.extractStrategy && typeof e.extractStrategy === "object") {
        def.extractStrategy = e.extractStrategy as ElementExtractStrategy;
      }
      return def;
    });
}

export async function loadConfigElements(evaluationTypeId: number | null): Promise<ElementDef[]> {
  if (!evaluationTypeId) return [];
  const config = await getConfig(evaluationTypeId);
  if (!config?.elements) return [];
  try {
    const raw = typeof config.elements === "string" ? JSON.parse(config.elements) : config.elements;
    return parseConfigElements(raw);
  } catch {
    return [];
  }
}

function formatElementsTableAsText(table: ElementRow[]): string {
  return table.map((r) => `${r.element} | ${r.content}`).join("\n");
}

function structuredIndexToProjectData(sessionId: string): ProjectStructuredData | undefined {
  const index = loadProjectStructuredIndex(sessionId);
  if (!index?.files.length) return undefined;
  const excelFiles = index.files.filter((f) => f.type === "excel" && f.sheets?.length);
  if (excelFiles.length === 0) return undefined;
  return {
    files: excelFiles.map((f) => ({
      fileName: f.fileName,
      sheets: (f.sheets ?? []).map((s) => ({
        sheetName: s.sheetName,
        cells: s.cells,
      })),
    })),
  };
}

export type RunExtractPipelineInput = {
  sessionId: string;
  projectFilePaths: string[];
  evaluationTypeId: number | null;
  useAgent?: boolean;
  skipReindex?: boolean;
};

/**
 * Pipeline LLM-first: ingesta (si hace falta) → extracción por elemento con búsqueda integral.
 */
export async function* runExtractPipeline(
  input: RunExtractPipelineInput
): AsyncGenerator<ExtractStreamEvent> {
  const { sessionId, projectFilePaths, evaluationTypeId, skipReindex } = input;

  if (projectFilePaths.length === 0) {
    yield { type: "done", text: "" };
    return;
  }

  const configElements = await loadConfigElements(evaluationTypeId);
  const evaluationType =
    evaluationTypeId != null ? await getEvaluationTypeById(evaluationTypeId) : null;
  const extractConfig =
    evaluationTypeId != null
      ? (await getEvaluationTypeSettings(evaluationTypeId)).extract
      : undefined;
  const evaluationTypeName = evaluationType?.name ?? null;
  const elementTimeoutMs = extractConfig?.elementTimeoutMs ?? ELEMENT_TIMEOUT_MS;

  const canSkipIndex = skipReindex !== false && projectIndexMatches(sessionId, projectFilePaths);
  if (canSkipIndex) {
    yield { type: "step", message: "Índice del proyecto vigente; omitiendo re-indexación." };
  } else {
    yield { type: "step", message: "Indexando documentos del proyecto (estructurado + RAG)…" };
    try {
      const { chunkCount, structuredFileCount } = await ingestProjectFiles(
        sessionId,
        projectFilePaths,
        extractConfig
      );
      yield {
        type: "step",
        message:
          chunkCount > 0
            ? `Índice listo (${structuredFileCount} archivo(s), ${chunkCount} fragmentos RAG).`
            : "Índice vacío; se intentará extracción con lo disponible.",
      };
    } catch (e) {
      const indexError = e instanceof Error ? e.message : String(e);
      yield { type: "step", message: `Aviso: no se pudo indexar el proyecto (${indexError}).` };
    }
  }

  const structuredData = structuredIndexToProjectData(sessionId);

  if (configElements.length === 0) {
    yield { type: "step", message: "Sin elementos configurados; extrayendo texto plano…" };
    const textParts: string[] = [];
    for (const filePath of projectFilePaths) {
      if (!fs.existsSync(filePath)) continue;
      const ext = path.extname(filePath).toLowerCase();
      let text = "";
      try {
        if (LIBRARY_EXTS.includes(ext)) text = await extractTextFromFile(filePath);
        else if (VISION_EXTS.includes(ext))
          text = await extractTextWithVision(filePath, { prompt: extractConfig?.vision.indexPrompt });
      } catch {
        /* skip */
      }
      if (text && !text.startsWith("[")) {
        textParts.push(`### ${path.basename(filePath)}\n\n${text.slice(0, 20_000)}`);
      }
    }
    const combined = textParts.join("\n\n---\n\n");
    yield { type: "done", text: combined, structuredData };
    return;
  }

  yield { type: "step", message: "Extracción LLM por elemento (búsqueda integral en el proyecto)…" };

  setExtractRunContext(extractConfig);
  try {
  let elementsTable: ElementRow[] = [];

  for (const element of configElements) {
    yield { type: "step", message: `Buscando en proyecto: ${element.title}…` };

    const { content, method } = await extractElementHybrid(sessionId, element, {
      timeoutMs: elementTimeoutMs,
      extractConfig,
      evaluationTypeName,
    });

    elementsTable.push({
      section: (element.section ?? "General").trim() || "General",
      element: element.title,
      content,
    });

    yield { type: "element", name: element.title, method };
  }

  const duplicateGroups = findDuplicateContentGroups(elementsTable, extractConfig?.duplicateGuard);
  if (duplicateGroups.length > 0) {
    yield {
      type: "step",
      message: `Detectadas ${duplicateGroups.length} respuesta(s) duplicada(s); re-extrayendo con revisión…`,
    };

    const byElement = new Map(elementsTable.map((r) => [r.element, r]));

    for (const group of duplicateGroups) {
      for (const title of group.titles) {
        const def = configElements.find((e) => e.title === title);
        if (!def) continue;

        const others = group.titles.filter((t) => t !== title);
        const hint = buildDuplicateRetryHint(title, others, group.sharedContent, extractConfig?.duplicateGuard);

        yield { type: "step", message: `Revisando duplicado: ${title}…` };

        const { content, method } = await extractElementHybrid(sessionId, def, {
          timeoutMs: elementTimeoutMs,
          extraHints: hint,
          skipDeterministic: true,
          extractConfig,
          evaluationTypeName,
        });

        const row = byElement.get(title);
        if (row) {
          row.content = content;
          yield { type: "element", name: title, method: `${method}:dup_retry` };
        }
      }
    }

    elementsTable = [...byElement.values()];
  }

  // Factor innovador no debe ser copia de continuidad
  const continuityRow = elementsTable.find((r) => r.element.toLowerCase().includes("continuidad"));
  const innovadorDef = configElements.find((e) => isFactorInnovadorElement(e));
  if (continuityRow && innovadorDef) {
    const innovadorRow = elementsTable.find((r) => r.element === innovadorDef.title);
    if (
      innovadorRow &&
      (looksLikeContinuityAnswer(innovadorRow.content) ||
        innovadorRow.content.trim() === continuityRow.content.trim())
    ) {
      yield {
        type: "step",
        message: `Corrigiendo Factor innovador (copiaba continuidad)…`,
      };
      const hint = buildDuplicateRetryHint(
        innovadorDef.title,
        [continuityRow.element],
        continuityRow.content,
        extractConfig?.duplicateGuard
      );
      const { content, method } = await extractElementHybrid(sessionId, innovadorDef, {
        timeoutMs: elementTimeoutMs,
        extraHints: hint,
        skipDeterministic: false,
        extractConfig,
        evaluationTypeName,
      });
      innovadorRow.content = content;
      yield { type: "element", name: innovadorDef.title, method: `${method}:continuity_fix` };
    }
  }

  const validatedTable = markIncompleteRows(elementsTable, configElements);
  const text = formatElementsTableAsText(validatedTable);
  const genericJson = {
    source: "llm_first",
    elements: validatedTable.map((r) => ({ element: r.element, content: r.content })),
  };

  yield {
    type: "done",
    text,
    structuredData: structuredData ?? genericJson,
    elementsTable: validatedTable,
  };
  } finally {
    setExtractRunContext(undefined);
  }
}

/** Reintento interactivo de un solo elemento (desde chat o API). */
export async function retryExtractElement(input: {
  sessionId: string;
  evaluationTypeId: number;
  projectFilePaths: string[];
  elementTitle: string;
  skipReindex?: boolean;
}): Promise<{ element: string; content: string; incomplete?: boolean; method?: string }> {
  const configElements = await loadConfigElements(input.evaluationTypeId);
  const element = configElements.find((e) => e.title === input.elementTitle);

  if (!element) {
    return { element: input.elementTitle, content: "", incomplete: true };
  }

  const needsIndex =
    input.skipReindex !== true && !projectIndexMatches(input.sessionId, input.projectFilePaths);

  if (needsIndex) {
    await ingestProjectFiles(input.sessionId, input.projectFilePaths, extractConfig);
  }

  const extractConfig = (await getEvaluationTypeSettings(input.evaluationTypeId)).extract;
  const evaluationType = await getEvaluationTypeById(input.evaluationTypeId);

  const { content, method } = await extractElementHybrid(input.sessionId, element, {
    timeoutMs: extractConfig.elementTimeoutMs,
    extractConfig,
    evaluationTypeName: evaluationType?.name ?? null,
  });

  const validated = markIncompleteRows(
    [{ section: element.section ?? "General", element: element.title, content }],
    [element]
  );

  return {
    element: element.title,
    content,
    incomplete: validated[0]?.incomplete,
    method,
  };
}
