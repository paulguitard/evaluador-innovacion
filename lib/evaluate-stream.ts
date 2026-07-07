import type { AgentTraceEntry } from "@/lib/agent-events";
import type { EvaluateStreamEvent } from "@/lib/evaluate-pipeline";
import { formatIndicatorScore } from "@/lib/evaluation-scores";

let traceIdCounter = 0;
function nextTraceId(): string {
  traceIdCounter += 1;
  return `trace-${traceIdCounter}`;
}

export type EvaluateStreamState = {
  trace: AgentTraceEntry[];
};

export function createEvaluateStreamState(): EvaluateStreamState {
  return { trace: [] };
}

export function formatEvaluateCompletionMessage(): string {
  return "Informe listo en el panel derecho.";
}

export function applyEvaluateStreamEvent(
  state: EvaluateStreamState,
  event: EvaluateStreamEvent,
  live: boolean
): EvaluateStreamState {
  const trace = [...state.trace];

  switch (event.type) {
    case "step":
      trace.push({
        id: nextTraceId(),
        kind: "step",
        title: event.message,
        live,
      });
      break;
    case "dimension":
      trace.push({
        id: nextTraceId(),
        kind: "step",
        title: `${event.name} ✓`,
        detail: `Dimensión ${event.index}/${event.total} analizada`,
        live: false,
      });
      break;
    case "subdimension":
      trace.push({
        id: nextTraceId(),
        kind: "step",
        title: `${event.name} ✓`,
        detail: `Subdimensión ${event.index}/${event.total} (${event.dimension})`,
        live: false,
      });
      break;
    case "subdimension_score":
      if (event.score != null) {
        trace.push({
          id: nextTraceId(),
          kind: "step",
          title: `Nota ${event.name}: ${event.score}`,
          detail: event.dimension,
          live: false,
        });
      }
      break;
    case "scores_summary":
      if (event.overallScore != null) {
        trace.push({
          id: nextTraceId(),
          kind: "step",
          title: `Indicador general: ${formatIndicatorScore(event.overallScore)}`,
          live: false,
        });
      }
      break;
    case "evaluation_summary":
      trace.push({
        id: nextTraceId(),
        kind: "step",
        title: "Síntesis evaluativa generada",
        live: false,
      });
      break;
    case "formatting":
      trace.push({
        id: nextTraceId(),
        kind: "step",
        title: event.message,
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

  return { trace };
}

export function parseEvaluateNdjsonLine(line: string): EvaluateStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as EvaluateStreamEvent;
  } catch {
    return null;
  }
}
