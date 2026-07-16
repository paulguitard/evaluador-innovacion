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
import { looksLikeCompleteIgipReport } from "@/lib/report-completeness";

export type EvaluateStreamResult = {
  reportContent: string;
  reportDraft: string;
  reportComplete: boolean;
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

async function retryFormatReport(params: {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  rawEvaluation: string;
  subdimensionScores?: Record<string, number | null>;
  overallScore?: number | null;
  signal?: AbortSignal;
}): Promise<{
  reportContent: string;
  evaluationSummary: string;
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
}> {
  const res = await fetch("/api/format-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evaluationTypeId: params.evaluationTypeId,
      projectElementsTable: params.projectElementsTable,
      rawEvaluation: params.rawEvaluation,
      subdimensionScores: params.subdimensionScores,
      overallScore: params.overallScore,
    }),
    signal: params.signal,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    throw new Error(
      err.message || err.error || `Error al formatear informe (HTTP ${res.status})`
    );
  }
  const data = (await res.json()) as {
    reportContent?: string;
    evaluationSummary?: string;
    subdimensionScores?: Record<string, number | null>;
    overallScore?: number | null;
  };
  if (!data.reportContent?.trim()) {
    throw new Error("El reintento de formateo no devolvió informe.");
  }
  return {
    reportContent: formatReportContent(data.reportContent),
    evaluationSummary: data.evaluationSummary?.trim() ?? "",
    subdimensionScores: data.subdimensionScores ?? {},
    overallScore: data.overallScore ?? null,
  };
}

export type EvaluateScoresUpdate = {
  subdimensionScores: Record<string, number | null>;
  /** null mientras corre la evaluación; se informa al cerrar el informe final. */
  overallScore: number | null;
};

export async function runEvaluateStream(params: {
  evaluationTypeId: number;
  projectElementsTable: { element: string; content: string }[];
  onTraceUpdate?: (trace: AgentTraceEntry[]) => void;
  onIndexProgress?: (progress: KnowledgeIndexProgress) => void;
  onReportDraft?: (content: string) => void;
  onReportContent?: (content: string) => void;
  /** Notas por subdimensión en vivo; overallScore solo tras el informe final. */
  onScoresUpdate?: (scores: EvaluateScoresUpdate) => void;
  signal?: AbortSignal;
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
  let reportDraft = "";
  let receivedReportContent = false;
  let subdimensionScores: Record<string, number | null> = {};
  let overallScore: number | null = null;
  let evaluationSummary = "";

  const applyDraft = (content: string) => {
    const formatted = formatReportContent(content);
    reportDraft = formatted;
    if (formatted.trim()) params.onReportDraft?.(formatted);
  };

  const applyFinal = (content: string) => {
    const formatted = formatReportContent(content);
    reportContent = formatted;
    if (formatted.trim()) params.onReportContent?.(formatted);
  };

  const handleEvent = (event: EvaluateStreamEvent, live: boolean) => {
    if (event.type === "error") {
      throw new Error(event.error?.trim() || "Error en el pipeline de evaluación");
    }
    if (event.type === "report_draft") {
      applyDraft(event.content);
      streamState = applyEvaluateStreamEvent(streamState, event, live);
      params.onTraceUpdate?.(
        streamState.trace.map((t, i) => ({
          ...t,
          live: i === streamState.trace.length - 1 && t.live,
        }))
      );
      return;
    }
    if (event.type === "report_content") {
      receivedReportContent = true;
      applyFinal(event.content);
      return;
    }
    if (event.type === "evaluation_scores") {
      subdimensionScores = { ...event.payload.subdimensionScores };
      // Conservar overall para el resultado final, pero no exponerlo a la UI aún.
      overallScore = event.payload.overallScore;
      params.onScoresUpdate?.({
        subdimensionScores: { ...subdimensionScores },
        overallScore: null,
      });
    }
    if (event.type === "subdimension_score") {
      const key = `${event.dimension} / ${event.name}`;
      subdimensionScores[key] = event.score;
      params.onScoresUpdate?.({
        subdimensionScores: { ...subdimensionScores },
        overallScore: null,
      });
    }
    if (event.type === "scores_summary") {
      subdimensionScores = { ...event.subdimensionScores };
      overallScore = event.overallScore;
      params.onScoresUpdate?.({
        subdimensionScores: { ...subdimensionScores },
        overallScore,
      });
    }
    if (event.type === "evaluation_summary") {
      evaluationSummary = event.text;
    }
    streamState = applyEvaluateStreamEvent(streamState, event, live);
    params.onTraceUpdate?.(
      streamState.trace.map((t, i) => ({
        ...t,
        live: i === streamState.trace.length - 1 && t.live,
      }))
    );
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
      handleEvent(event, true);
    }
  }

  if (buffer.trim()) {
    const event = parseEvaluateNdjsonLine(buffer);
    if (event) handleEvent(event, false);
  }

  const needsFormatRetry = !receivedReportContent && !!reportDraft.trim();

  if (needsFormatRetry) {
    params.onTraceUpdate?.([
      ...streamState.trace.map((t) => ({ ...t, live: false })),
      progressToTrace("Reintentando formateo del informe (sin re-evaluar subdimensiones)…"),
    ]);
    try {
      const formatted = await retryFormatReport({
        evaluationTypeId: params.evaluationTypeId,
        projectElementsTable: params.projectElementsTable,
        rawEvaluation: reportDraft || reportContent,
        subdimensionScores,
        overallScore,
        signal: params.signal,
      });
      reportContent = formatted.reportContent;
      if (formatted.evaluationSummary) evaluationSummary = formatted.evaluationSummary;
      if (Object.keys(formatted.subdimensionScores).length > 0) {
        subdimensionScores = formatted.subdimensionScores;
      }
      if (formatted.overallScore != null) overallScore = formatted.overallScore;
      params.onReportContent?.(reportContent);
      params.onScoresUpdate?.({
        subdimensionScores: { ...subdimensionScores },
        overallScore,
      });
    } catch (e) {
      throw new Error(
        e instanceof Error
          ? e.message
          : "El formateo del informe se interrumpió y el reintento falló. Reintente la evaluación."
      );
    }
  }

  if (!reportContent.trim() || !looksLikeCompleteIgipReport(reportContent)) {
    throw new Error(
      "La evaluación no generó un informe completo (faltan resumen, síntesis o notas). Reintente la evaluación."
    );
  }

  return {
    reportContent,
    reportDraft,
    reportComplete: true,
    subdimensionScores,
    overallScore,
    evaluationSummary,
    trace: streamState.trace.map((t) => ({ ...t, live: false })),
  };
}

export type { EvaluateStreamEvent };
