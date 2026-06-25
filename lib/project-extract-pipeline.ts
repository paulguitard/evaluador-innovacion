import path from "path";

import fs from "fs";

import { getConfig } from "@/lib/db";

import { chatCompletion } from "@/lib/openrouter";

import { extractTextFromFile } from "@/lib/document-parser";

import { extractTextWithVision } from "@/lib/extract-with-vision";

import { extractExcelToStructuredJson, type ExcelStructuredData } from "@/lib/excel-structured-extract";

import { indexProjectFiles } from "@/lib/project-rag-index";

import {

  retrieveProjectChunksMulti,

  formatProjectChunksForPrompt,

} from "@/lib/project-rag-retrieve";

import {

  extractAllElementsHeuristic,

  isHighConfidenceHeuristic,

  needsLlmFallback,

  type ElementDef,

} from "@/lib/excel-heuristics";

import { extractElementWithAgent } from "@/lib/project-extract-agent";

import { keywordScanProject } from "@/lib/project-keyword-scan";

import {
  isIncompleteElement,
  isShortMetadataElement,
  markIncompleteRows,
} from "@/lib/project-extract-validate";

import { isProjectNameElement } from "@/lib/excel-sheet-priority";

import { detectProjectName } from "@/lib/project-name-detect";

import { loadProjectChunks } from "@/lib/project-vector-store";

import { finalizeContentForElement } from "@/lib/extract-content-clean";
import {
  extractSpecificObjectivesFromExcel,
  isSpecificObjectivesElement,
} from "@/lib/objective-extract";
import {
  extractFormRowFromExcel,
  isFormRowElement,
} from "@/lib/form-row-extract";
import { allowFallbackOverwrite } from "@/lib/extract-source-policy";

import type { ProjectStructuredData } from "@/lib/build-context";



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

const EXCEL_EXTS = [".xlsx"];

const VISION_EXTS = [".jpg", ".jpeg", ".png", ".webp"];



const PER_ELEMENT_EXTRACT_PROMPT = `Extrae el contenido del documento para UN elemento concreto de un proyecto de innovación.



Reglas:

- Transcribe el texto exactamente, sin resumir ni acortar.

- Si no aparece en los fragmentos, devuelve content vacío.

- Responde ÚNICAMENTE JSON: {"content":"..."}`;



const HEURISTIC_CONFIDENCE_LLM = 0.55;



function parseConfigElements(raw: unknown): ElementDef[] {

  if (!Array.isArray(raw)) return [];

  return raw

    .filter((e): e is ElementDef => typeof e === "object" && e != null && "title" in e && "description" in e)

    .map((e) => ({

      title: String(e.title),

      description: String(e.description ?? ""),

      section: typeof e.section === "string" ? e.section : "General",

    }));

}



async function loadConfigElements(evaluationTypeId: number | null): Promise<ElementDef[]> {

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



function parseContentFromLlm(raw: string): string {

  const trimmed = raw.trim();

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (jsonMatch) {

    try {

      const obj = JSON.parse(jsonMatch[0]) as { content?: string };

      if (typeof obj.content === "string") return obj.content;

    } catch {

      /* fall through */

    }

  }

  return trimmed;

}



function formatElementsTableAsText(table: ElementRow[]): string {

  return table.map((r) => `${r.element} | ${r.content}`).join("\n");

}



function isHardCase(content: string, confidence: number, multiFile: boolean, element: ElementDef): boolean {

  if (isIncompleteElement(element, content)) return true;

  if (multiFile && content.length < 40 && !isShortMetadataElement(element)) return true;

  if (confidence > 0 && confidence < HEURISTIC_CONFIDENCE_LLM && content.length < 60) return true;

  return false;

}

const AUTO_RETRY_MAX_ROUNDS = 3;

async function autoRetryIncompleteElements(
  sessionId: string,
  structuredFiles: ExcelStructuredData[],
  multiFile: boolean,
  configElements: ElementDef[],
  elementsTable: ElementRow[]
): Promise<{ element: string; method: string }[]> {
  const updates: { element: string; method: string }[] = [];

  for (let round = 0; round < AUTO_RETRY_MAX_ROUNDS; round++) {
    const incomplete = configElements.filter((el) => {
      const row = elementsTable.find((r) => r.element === el.title);
      return isIncompleteElement(el, row?.content ?? "");
    });
    if (incomplete.length === 0) break;

    for (const element of incomplete) {
      const rowIdx = elementsTable.findIndex((r) => r.element === element.title);
      let content = rowIdx >= 0 ? elementsTable[rowIdx].content : "";
      const prior = content.trim();

      const keywordHit = !isFormRowElement(element)
        ? keywordScanProject(sessionId, structuredFiles, element)
        : "";
      if (keywordHit.trim().length > content.trim().length) {
        content = keywordHit;
      }

      if (isIncompleteElement(element, content)) {
        if (isFormRowElement(element)) {
          const formRow = extractFormRowFromExcel(structuredFiles, element);
          if (formRow && formRow.content.trim().length > content.trim().length) {
            content = formRow.content;
          }
        } else {
          const rag = await extractElementWithRagLlm(sessionId, element);
          if (rag.trim().length > content.trim().length) {
            content = rag;
          }
        }
      }

      if (isIncompleteElement(element, content)) {
        const agentContent = await extractElementWithAgent(sessionId, element, {
          structuredFiles,
          multiFile,
          priorContent: content,
        });
        if (agentContent.trim().length > content.trim().length) {
          content = agentContent;
        }
      }

      content = finalizeContentForElement(content, element);
      if (rowIdx >= 0 && content.trim().length > prior.length) {
        elementsTable[rowIdx] = { ...elementsTable[rowIdx], content };
        updates.push({ element: element.title, method: `auto_retry_${round + 1}` });
      }
    }
  }

  return updates;
}



function maxTokensForElement(element: ElementDef): number {

  if (/cronograma|actividad|plan|presupuesto|indicador/i.test(`${element.title} ${element.description}`)) {

    return 8192;

  }

  return 4096;

}



function buildElementQueries(element: ElementDef): string[] {

  return [

    `${element.title}. ${element.description}`,

    element.title,

    element.description,

  ].filter((q) => q.trim().length > 0);

}



async function extractElementWithRagLlm(sessionId: string, element: ElementDef): Promise<string> {

  const chunks = await retrieveProjectChunksMulti(sessionId, buildElementQueries(element), {

    topK: 16,

    maxRetrievedChars: 20_000,

    expandNeighbors: true,

  });



  if (chunks.length === 0) return "";



  const context = formatProjectChunksForPrompt(chunks);



  const response = await chatCompletion(

    [

      { role: "system", content: PER_ELEMENT_EXTRACT_PROMPT },

      {

        role: "user",

        content: `Elemento: "${element.title}"\nDescripción: ${element.description}\n\nFragmentos del documento:\n${context}`,

      },

    ],

    { max_tokens: maxTokensForElement(element), temperature: 0.1 }

  );



  return parseContentFromLlm(response?.trim() ?? "");

}



type ParsedFiles = {

  structuredFiles: ExcelStructuredData[];

  multiFile: boolean;

  fileCount: number;

};



async function loadLeadTextSnippets(projectFilePaths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const filePath of projectFilePaths) {
    if (!fs.existsSync(filePath)) continue;
    const ext = path.extname(filePath).toLowerCase();
    if (EXCEL_EXTS.includes(ext)) continue;
    try {
      let text = "";
      if (LIBRARY_EXTS.includes(ext)) text = await extractTextFromFile(filePath);
      else if (VISION_EXTS.includes(ext)) text = await extractTextWithVision(filePath);
      if (text && !text.startsWith("[")) out.push(text.slice(0, 8000));
    } catch {
      /* skip */
    }
  }
  return out;
}

async function parseProjectFiles(projectFilePaths: string[]): Promise<ParsedFiles> {

  const structuredFiles: ExcelStructuredData[] = [];

  let fileCount = 0;



  for (const filePath of projectFilePaths) {

    if (!filePath || !fs.existsSync(filePath)) continue;

    fileCount += 1;

    const ext = path.extname(filePath).toLowerCase();

    if (EXCEL_EXTS.includes(ext)) {

      try {

        const data = await extractExcelToStructuredJson(filePath);

        if (data.sheets.length > 0) structuredFiles.push(data);

      } catch {

        /* indexará como texto vía RAG */

      }

    }

  }



  return {

    structuredFiles,

    multiFile: fileCount > 1,

    fileCount,

  };

}



export type RunExtractPipelineInput = {

  sessionId: string;

  projectFilePaths: string[];

  evaluationTypeId: number | null;

  useAgent?: boolean;

};



/**

 * Pipeline de extracción:

 * heurísticas → RAG multi-query → keyword scan → agente (siempre en vacíos/incompletos)

 */

export async function* runExtractPipeline(

  input: RunExtractPipelineInput

): AsyncGenerator<ExtractStreamEvent> {

  const { sessionId, projectFilePaths, evaluationTypeId } = input;



  if (projectFilePaths.length === 0) {

    yield { type: "done", text: "" };

    return;

  }



  const configElements = await loadConfigElements(evaluationTypeId);



  yield { type: "step", message: "Indexando documentos del proyecto para búsqueda…" };

  try {

    const { chunkCount } = await indexProjectFiles(sessionId, projectFilePaths);

    yield {

      type: "step",

      message:

        chunkCount > 0

          ? `Índice del proyecto listo (${chunkCount} fragmentos).`

          : "Índice del proyecto vacío; se usarán heurísticas.",

    };

  } catch (e) {

    const indexError = e instanceof Error ? e.message : String(e);

    yield { type: "step", message: `Aviso: no se pudo indexar el proyecto (${indexError}).` };

  }



  const { structuredFiles, multiFile } = await parseProjectFiles(projectFilePaths);



  const structuredData: ProjectStructuredData | undefined =

    structuredFiles.length > 0 ? { files: structuredFiles } : undefined;



  if (configElements.length === 0) {

    yield { type: "step", message: "Sin elementos configurados; extrayendo texto plano…" };

    const textParts: string[] = [];

    for (const filePath of projectFilePaths) {

      if (!fs.existsSync(filePath)) continue;

      const ext = path.extname(filePath).toLowerCase();

      let text = "";

      try {

        if (LIBRARY_EXTS.includes(ext)) text = await extractTextFromFile(filePath);

        else if (VISION_EXTS.includes(ext)) text = await extractTextWithVision(filePath);

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



  yield { type: "step", message: "Aplicando heurísticas Excel y extracción por elemento…" };



  const heuristicMap =

    structuredFiles.length > 0 ? extractAllElementsHeuristic(structuredFiles, configElements) : new Map();

  const leadTexts = await loadLeadTextSnippets(projectFilePaths);

  const plainForName = [...leadTexts, ...loadProjectChunks(sessionId).slice(0, 6).map((c) => c.text)];



  const elementsTable: ElementRow[] = [];

  const hardCases: ElementDef[] = [];



  for (const element of configElements) {

    const heuristic = heuristicMap.get(element.title) ?? {

      content: "",

      confidence: 0,

      method: "none" as const,

    };



    let content = "";

    let method = "heuristic";



    if (isProjectNameElement(element)) {

      const detected = detectProjectName(structuredFiles, plainForName);

      if (detected && detected.score >= 42) {

        content = detected.text;

        method = `project_prominent:${detected.method}`;

      }

    } else if (isSpecificObjectivesElement(element)) {

      const extracted = extractSpecificObjectivesFromExcel(structuredFiles);

      if (extracted) {

        content = extracted.content;

        method = "objectives_section";

      }

    } else if (isFormRowElement(element)) {

      const extracted = extractFormRowFromExcel(structuredFiles, element);

      if (extracted) {

        content = extracted.content;

        method = "form_row";

      }

    }



    if (!content.trim() && isHighConfidenceHeuristic(heuristic.confidence) && heuristic.content.trim()) {

      content = heuristic.content;

      method = `heuristic:${heuristic.method}`;

    } else if (!content.trim() && !needsLlmFallback(heuristic.confidence, heuristic.content) && heuristic.content.trim()) {

      content = heuristic.content;

      method = `heuristic:${heuristic.method}`;

    } else if (!content.trim()) {

      if (isFormRowElement(element)) {
        const extracted = extractFormRowFromExcel(structuredFiles, element);
        if (extracted) {
          content = extracted.content;
          method = "form_row";
        }
      }

      if (!content.trim() && !isFormRowElement(element)) {

      yield { type: "step", message: `Extrayendo con RAG: ${element.title}…` };

      content = await extractElementWithRagLlm(sessionId, element);

      method = "rag_llm";



      if (!content.trim() && heuristic.content.trim()) {

        content = heuristic.content;

        method = `heuristic_fallback:${heuristic.method}`;

      }

      }

    }



    if (isIncompleteElement(element, content) && allowFallbackOverwrite(method, !!content.trim())) {

      yield { type: "step", message: `Búsqueda por keywords: ${element.title}…` };

      const keywordHit = keywordScanProject(sessionId, structuredFiles, element);

      if (keywordHit.trim().length > content.trim().length) {

        content = keywordHit;

        method = "keyword_scan";

      }

    }



    if (isHardCase(content, heuristic.confidence, multiFile, element)) {

      hardCases.push(element);

    }



    elementsTable.push({

      section: (element.section ?? "General").trim() || "General",

      element: element.title,

      content: finalizeContentForElement(content, element),

    });



    yield { type: "element", name: element.title, method };

  }



  if (hardCases.length > 0) {

    yield {

      type: "step",

      message: `Agente de reintento para ${hardCases.length} elemento(s) vacío(s) o incompleto(s)…`,

    };



    for (const element of hardCases) {

      const rowIdx = elementsTable.findIndex((r) => r.element === element.title);

      const prior = rowIdx >= 0 ? elementsTable[rowIdx].content : "";



      const agentContent = await extractElementWithAgent(sessionId, element, {

        structuredFiles,

        multiFile,

        priorContent: prior,

      });



      if (agentContent.trim().length > prior.trim().length) {

        if (rowIdx >= 0) {

          elementsTable[rowIdx] = { ...elementsTable[rowIdx], content: agentContent };

        }

        yield { type: "element", name: `${element.title} (agente)`, method: "agent" };

      }

    }

  }



  const stillIncomplete = configElements.filter((el) => {
    const row = elementsTable.find((r) => r.element === el.title);
    return isIncompleteElement(el, row?.content ?? "");
  });

  if (stillIncomplete.length > 0) {
    yield {
      type: "step",
      message: `Reintento automático para ${stillIncomplete.length} elemento(s) incompleto(s)…`,
    };

    const retryUpdates = await autoRetryIncompleteElements(
      sessionId,
      structuredFiles,
      multiFile,
      configElements,
      elementsTable
    );

    for (const u of retryUpdates) {
      yield { type: "element", name: u.element, method: u.method };
    }
  }



  const validatedTable = markIncompleteRows(elementsTable, configElements);

  const text = formatElementsTableAsText(validatedTable);

  const genericJson = {

    source: "pipeline",

    elements: validatedTable.map((r) => ({ element: r.element, content: r.content })),

  };



  yield {

    type: "done",

    text,

    structuredData: structuredData ?? genericJson,

    elementsTable: validatedTable,

  };

}



/** Reintento interactivo de un solo elemento (desde chat o API). */

export async function retryExtractElement(input: {

  sessionId: string;

  evaluationTypeId: number;

  projectFilePaths: string[];

  elementTitle: string;

}): Promise<{ element: string; content: string; incomplete?: boolean }> {

  const configElements = await loadConfigElements(input.evaluationTypeId);

  const element = configElements.find((e) => e.title === input.elementTitle);

  if (!element) {

    return { element: input.elementTitle, content: "", incomplete: true };

  }



  await indexProjectFiles(input.sessionId, input.projectFilePaths);

  const { structuredFiles, multiFile } = await parseProjectFiles(input.projectFilePaths);



  let content = keywordScanProject(input.sessionId, structuredFiles, element);

  if (isIncompleteElement(element, content)) {

    content = await extractElementWithAgent(input.sessionId, element, {

      structuredFiles,

      multiFile,

      priorContent: content,

    });

  }



  return {

    element: element.title,

    content,

    incomplete: isIncompleteElement(element, content),

  };

}


