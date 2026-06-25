import { chatCompletion } from "@/lib/openrouter";

import {

  retrieveProjectChunksMulti,

  formatProjectChunksForPrompt,

} from "@/lib/project-rag-retrieve";

import type { ElementDef } from "@/lib/excel-heuristics";

import type { ExcelStructuredData } from "@/lib/excel-structured-extract";

import { extractElementHeuristic, needsLlmFallback } from "@/lib/excel-heuristics";

import { keywordScanProject } from "@/lib/project-keyword-scan";
import { isProjectNameElement } from "@/lib/excel-sheet-priority";
import { detectProjectName } from "@/lib/project-name-detect";
import { loadProjectChunks } from "@/lib/project-vector-store";



const AGENT_EXTRACT_PROMPT = `Eres un agente de extracción para documentos de proyecto de innovación.

Recibes fragmentos de uno o más archivos y debes extraer el contenido de UN elemento concreto.



Reglas:

- Transcribe el contenido exactamente, sin resumir ni omitir.

- Si el contenido está repartido en varios fragmentos, combínalo en orden lógico.

- Si no encuentras el elemento, devuelve content vacío.

- Responde ÚNICAMENTE JSON: {"content":"..."}`;



const MAX_AGENT_ITERATIONS = 3;



function parseContentJson(raw: string): string {

  const trimmed = raw.trim();

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (!jsonMatch) return "";

  try {

    const obj = JSON.parse(jsonMatch[0]) as { content?: string };

    return typeof obj.content === "string" ? obj.content : "";

  } catch {

    return "";

  }

}



function buildElementQueries(element: ElementDef): string[] {

  return [

    `${element.title} ${element.description}`,

    element.title,

    element.description,

  ].filter(Boolean);

}



/**

 * Agente para casos difíciles: multi-query RAG ampliado + keyword + hasta 3 iteraciones LLM.

 */

export async function extractElementWithAgent(

  sessionId: string,

  element: ElementDef,

  options?: {

    structuredFiles?: ExcelStructuredData[];

    multiFile?: boolean;

    priorContent?: string;

  }

): Promise<string> {

  if (isProjectNameElement(element)) {

    const plain = loadProjectChunks(sessionId).slice(0, 8).map((c) => c.text);

    const detected = detectProjectName(options?.structuredFiles ?? [], plain);

    if (detected && detected.score >= 42) return detected.text;

  }

  if (options?.structuredFiles?.length) {

    const heuristic = extractElementHeuristic(options.structuredFiles, element);

    if (!needsLlmFallback(heuristic.confidence, heuristic.content) && heuristic.content.trim()) {

      return heuristic.content;

    }

  }



  const keywordHit = keywordScanProject(

    sessionId,

    options?.structuredFiles ?? [],

    element

  );

  if (keywordHit.trim().length > (options?.priorContent?.trim().length ?? 0) && keywordHit.length >= 80) {

    return keywordHit;

  }



  const chunks = await retrieveProjectChunksMulti(sessionId, buildElementQueries(element), {

    topK: options?.multiFile ? 18 : 14,

    maxRetrievedChars: 22_000,

    expandNeighbors: true,

  });



  if (chunks.length === 0) return options?.priorContent?.trim() ?? keywordHit;



  const context = formatProjectChunksForPrompt(chunks);

  let bestContent = keywordHit.trim().length > (options?.priorContent?.trim().length ?? 0)

    ? keywordHit

    : (options?.priorContent?.trim() ?? "");



  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {

    const extraHint =

      i > 0

        ? `\nIntento ${i + 1}: el resultado anterior fue insuficiente. Busca en todo el contexto, incluyendo tablas y listas numeradas.`

        : "";

    const userContent = `Elemento: "${element.title}"

Descripción: ${element.description}

${options?.priorContent ? `Contenido previo (puede estar incompleto): ${options.priorContent.slice(0, 500)}` : ""}



Fragmentos del proyecto:

${context}

${extraHint}`;



    const response = await chatCompletion(

      [

        { role: "system", content: AGENT_EXTRACT_PROMPT },

        { role: "user", content: userContent },

      ],

      { max_tokens: 8192, temperature: 0.1 }

    );



    const content = parseContentJson(response?.trim() ?? "");

    if (content.length > bestContent.length) {

      bestContent = content;

    }

    if (content.length >= 80) break;

  }



  return bestContent;

}


