import type { EvaluateStreamEvent } from "@/lib/evaluate-pipeline";
import type { AgentTraceEntry } from "@/lib/agent-events";
import {
  applyEvaluateStreamEvent,
  createEvaluateStreamState,
  parseEvaluateNdjsonLine,
} from "@/lib/evaluate-stream";
import { stripCharacterLimitAnnotations } from "@/lib/report-format-limits";
import { fetchBulkEvaluationConfig } from "@/lib/bulk-evaluation-config-client";
import { buildPrecomputedChunksForEvaluation } from "@/lib/evaluate-client-rag";
import {
  ensureKnowledgeIndex,
  type KnowledgeIndexProgress,
} from "@/lib/knowledge-index-cache";
import type { RetrievedChunk } from "@/lib/chunk-types";
import { sanitizeLlmEvaluationText } from "@/lib/llm-output-sanitize";

export type EvaluateStreamResult = {
  reportContent: string;
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
  evaluationSummary: string;
  trace: AgentTraceEntry[];
};

function formatReportContent(text: string): string {
  return sanitizeLlmEvaluationText(stripCharacterLimitAnnotations(text));
}

function progressToTrace(message: string): AgentTraceEntry {
  return {
    id: `idx-${Date.now()}`,
    kind: "step",
    title: message,
    detail: "",
    live: false,
  };
}

/**
 * El servidor solo usa texto/score de los fragmentos precomputados.
 * Sin embeddings el POST cabe en el límite de body de Vercel (~4,5 MB);
 * con topK alto + muchas subdimensiones el payload con vectores lo supera
 * y la respuesta falla con un error vacío ([Error: ]).
 */
function stripEmbeddingsForWire(
  map: Record<string, RetrievedChunk[]>
): Record<string, RetrievedChunk[]> {
  const out: Record<string, RetrievedChunk[]> = {};
  for (const [key, chunks] of Object.entries(map)) {
    out[key] = chunks.map((c) => ({
      id: c.id,
      docName: c.docName,
      text: c.text,
      score: c.score,
      embedding: [],
      ...(c.page != null ? { page: c.page } : {}),
      ...(c.printedPage != null ? { printedPage: c.printedPage } : {}),
    }));
  }
  return out;
}

function formatEvaluateHttpError(
  status: number,
  err: { message?: string; error?: string },
  statusText: string
): string {
  const detail = err?.message || err?.error || statusText || "";
  if (status === 413 || /payload|entity too large|body.*limit/i.test(detail)) {
    return (
      "La petición de evaluación es demasiado grande para el servidor. " +
      "Reduce topK de RAG en Configuración §5 o desactiva el índice local en Configurar masivo."
    );
  }
  if (detail.trim()) return detail;
  return `Error al evaluar (HTTP ${status}). Revisa los logs de Vercel o inténtalo de nuevo.`;
}

export async function runEvaluateStream(params: {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  onTraceUpdate?: (trace: AgentTraceEntry[]) => void;
  onIndexProgress?: (progress: KnowledgeIndexProgress) => void;
  /** Se llama al recibir cada report_content (borrador o final). */
  onReportContent?: (content: string) => void;
  signal?: AbortSignal;
  /** Índice ya cargado (p. ej. lote masivo). */
  knowledgeChunks?: import("@/lib/chunk-types").StoredChunk[];
}): Promise<EvaluateStreamResult> {
  const bulkConfig = await fetchBulkEvaluationConfig();
  let precomputedSubdimensionChunks: Record<string, RetrievedChunk[]> | undefined;

  if (bulkConfig.useClientKnowledgeIndex) {
    const chunks =
      params.knowledgeChunks ??
      (
        await ensureKnowledgeIndex(params.evaluationTypeId, (p) => {
          params.onIndexProgress?.(p);
          if (p.message) {
            params.onTraceUpdate?.([progressToTrace(p.message)]);
          }
        })
      ).chunks;

    params.onTraceUpdate?.([progressToTrace("Buscando fragmentos de referencia en índice local…")]);
    precomputedSubdimensionChunks = stripEmbeddingsForWire(
      await buildPrecomputedChunksForEvaluation({
        evaluationTypeId: params.evaluationTypeId,
        projectElementsTable: params.projectElementsTable,
        chunks,
      })
    );
  }

  const res = await fetch("/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evaluationTypeId: params.evaluationTypeId,
      projectElementsTable: params.projectElementsTable,
      precomputedSubdimensionChunks,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    throw new Error(formatEvaluateHttpError(res.status, err, res.statusText));
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let streamState = createEvaluateStreamState();
  let reportContent = "";
  let subdimensionScores: Record<string, number | null> = {};
  let overallScore: number | null = null;
  let evaluationSummary = "";
  let receivedDone = false;

  const applyReportContent = (content: string) => {
    const formatted = formatReportContent(content);
    reportContent = formatted;
    if (formatted.trim()) {
      params.onReportContent?.(formatted);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseEvaluateNdjsonLine(line);
      if (!event) continue;
      if (event.type === "error") {
        throw new Error(event.error?.trim() || "Error en el pipeline de evaluación");
      }
      if (event.type === "report_content") {
        applyReportContent(event.content);
        continue;
      }
      if (event.type === "done") {
        receivedDone = true;
      }
      if (event.type === "subdimension_score") {
        const key = `${event.dimension} / ${event.name}`;
        subdimensionScores[key] = event.score;
      }
      if (event.type === "scores_summary") {
        subdimensionScores = { ...event.subdimensionScores };
        overallScore = event.overallScore;
      }
      if (event.type === "evaluation_summary") {
        evaluationSummary = event.text;
      }
      streamState = applyEvaluateStreamEvent(streamState, event, true);
      params.onTraceUpdate?.(
        streamState.trace.map((t, i) => ({
          ...t,
          live: i === streamState.trace.length - 1 && t.live,
        }))
      );
    }
  }

  if (buffer.trim()) {
    const event = parseEvaluateNdjsonLine(buffer);
    if (event) {
      if (event.type === "error") {
        throw new Error(event.error?.trim() || "Error en el pipeline de evaluación");
      }
      if (event.type === "report_content") {
        applyReportContent(event.content);
      }
      if (event.type === "done") {
        receivedDone = true;
      }
      if (event.type === "scores_summary") {
        subdimensionScores = { ...event.subdimensionScores };
        overallScore = event.overallScore;
      }
      if (event.type === "evaluation_summary") {
        evaluationSummary = event.text;
      }
      if (event.type !== "report_content") {
        streamState = applyEvaluateStreamEvent(streamState, event, false);
      }
    }
  }

  if (!reportContent.trim()) {
    throw new Error(
      "La evaluación se interrumpió antes de generar el informe (suele ocurrir por timeout en plan Hobby de Vercel). Reintente o use plan Pro."
    );
  }

  let finalTrace = streamState.trace.map((t) => ({ ...t, live: false }));
  if (!receivedDone) {
    finalTrace = [
      ...finalTrace,
      {
        id: `partial-${Date.now()}`,
        kind: "step" as const,
        title:
          "Informe parcial: el formateo final se cortó (posible timeout). Revise el panel derecho.",
        detail: "",
        live: false,
      },
    ];
  }

  return {
    reportContent,
    subdimensionScores,
    overallScore,
    evaluationSummary,
    trace: finalTrace,
  };
}

export type { EvaluateStreamEvent };
