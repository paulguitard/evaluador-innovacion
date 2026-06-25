import type { AgentTraceEntry } from "@/lib/agent-events";
import type { ExtractStreamEvent } from "@/lib/project-extract-pipeline";
import type { KnowledgePathItem } from "@/lib/knowledge-config";

let traceIdCounter = 0;
function nextTraceId(): string {
  traceIdCounter += 1;
  return `trace-${traceIdCounter}`;
}

export type ExtractStreamState = {
  content: string;
  trace: AgentTraceEntry[];
};

export function createExtractStreamState(): ExtractStreamState {
  return { content: "", trace: [] };
}

export function knowledgePathItemLabel(item: KnowledgePathItem): string {
  return typeof item === "string" ? item : (item.name || "documento");
}

export function knowledgePathsToLabels(paths: KnowledgePathItem[]): string[] {
  return paths.map(knowledgePathItemLabel).filter((n) => n.trim());
}

/** Frase gramatical para citar uno o varios documentos técnicos del Knowledge. */
export function formatKnowledgeDocsPhrase(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "el Knowledge";
  const parts = clean.map((n) => `el "${n}"`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} o ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} o ${parts[parts.length - 1]}`;
}

export function formatExtractCompletionMessage(knowledgeDocNames: string[]): string {
  const knowledgePart = formatKnowledgeDocsPhrase(knowledgeDocNames);
  return `Extracción completada con éxito. ¿Te gustaría hacer alguna pregunta sobre el proyecto, la rúbrica o ${knowledgePart}?`;
}

export function applyExtractStreamEvent(
  state: ExtractStreamState,
  event: ExtractStreamEvent,
  live: boolean
): ExtractStreamState {
  const trace = [...state.trace];
  let content = state.content;

  switch (event.type) {
    case "step":
      trace.push({
        id: nextTraceId(),
        kind: "step",
        title: event.message,
        live,
      });
      break;
    case "element":
      trace.push({
        id: nextTraceId(),
        kind: "step",
        title: `${event.name} ✓`,
        detail: event.method ? `Método: ${event.method}` : undefined,
        live,
      });
      break;
    case "done":
      for (let i = 0; i < trace.length; i++) {
        if (trace[i].live) trace[i] = { ...trace[i], live: false };
      }
      break;
    case "error":
      break;
  }

  return { content, trace };
}

export function parseExtractNdjsonLine(line: string): ExtractStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ExtractStreamEvent;
  } catch {
    return null;
  }
}
