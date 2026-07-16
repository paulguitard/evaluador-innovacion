"use client";

import { useState, useRef, useCallback } from "react";
import type { ChatMessage } from "@/components/ChatPanel";
import type { BulkAgentSlot, BulkAgentSlotStatus } from "@/components/BulkAgentPanel";
import type { AgentTraceEntry } from "@/lib/agent-events";
import { fileBaseName } from "@/lib/evaluation-mode";
import { runExtractStream } from "@/lib/run-extract-stream";
import { runEvaluateStream } from "@/lib/run-evaluate-stream";
import { getLastStreamLine } from "@/lib/stream-line";
import { fetchBulkEvaluationConfig } from "@/lib/bulk-evaluation-config-client";
import {
  ensureKnowledgeIndex,
  releasePinnedKnowledgeIndex,
} from "@/lib/knowledge-index-cache";
import type { StoredChunk } from "@/lib/chunk-types";

export type BulkProjectStatus = "pending" | "running" | "done" | "error";

export type BulkProjectElementRow = {
  element: string;
  content: string;
};

export type BulkProjectRow = {
  id: string;
  fileName: string;
  projectName: string;
  file: File;
  extractionStatus: BulkProjectStatus;
  evaluationStatus: BulkProjectStatus;
  /** Tabla de elementos extraídos del proyecto (persistida para el chat masivo). */
  elementsTable: BulkProjectElementRow[];
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
  summary: string;
  reportContent: string;
  errorMessage?: string;
};

async function cleanupSession(sessionId: string): Promise<void> {
  await fetch("/api/session-cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}

function extractProjectName(
  elementsTable: { element: string; content: string }[],
  fileName: string
): string {
  const row = elementsTable.find(
    (r) => r.element.toLowerCase().trim() === "nombre del proyecto"
  );
  const content = row?.content?.trim();
  if (content && content !== "—" && content.length > 0) return content;
  return fileBaseName(fileName);
}

async function extractWithFile(
  file: File,
  sessionId: string,
  evaluationTypeId: number,
  signal?: AbortSignal,
  onTraceUpdate?: (trace: AgentTraceEntry[]) => void
) {
  return runExtractStream({
    projectFile: file,
    evaluationTypeId,
    sessionId,
    onTraceUpdate,
    signal,
  });
}

function rowIdForFile(index: number, fileName: string): string {
  return `bulk-${index}-${fileName}`;
}

export function useBulkEvaluation(
  activeTypeId: number | null,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
) {
  const [bulkRows, setBulkRows] = useState<BulkProjectRow[]>([]);
  const [bulkAgents, setBulkAgents] = useState<BulkAgentSlot[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdsRef = useRef<string[]>([]);

  const resetBulk = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBulkRows([]);
    setBulkAgents([]);
    setBulkRunning(false);
    for (const sid of sessionIdsRef.current) {
      void cleanupSession(sid);
    }
    sessionIdsRef.current = [];
  }, []);

  const cancelBulk = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBulkRunning(false);
  }, []);

  const initRowsFromFiles = useCallback((files: File[]) => {
    setBulkRows(
      files.map((file, i) => ({
        id: rowIdForFile(i, file.name),
        fileName: file.name,
        projectName: fileBaseName(file.name),
        file,
        extractionStatus: "pending",
        evaluationStatus: "pending",
        elementsTable: [],
        subdimensionScores: {},
        overallScore: null,
        summary: "",
        reportContent: "",
      }))
    );
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<BulkProjectRow>) => {
    setBulkRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const patchAgentSlot = useCallback((rowId: string, patch: Partial<BulkAgentSlot>) => {
    setBulkAgents((prev) => {
      const idx = prev.findIndex((slot) => slot.rowId === rowId);
      if (idx < 0) {
        return [
          ...prev,
          {
            rowId,
            slotIndex: patch.slotIndex ?? prev.length,
            projectName: patch.projectName ?? "",
            fileName: patch.fileName ?? "",
            status: patch.status ?? "pending",
            trace: patch.trace ?? [],
            streamLine: patch.streamLine ?? "Iniciando…",
            ...patch,
          },
        ];
      }
      return prev.map((slot) => (slot.rowId === rowId ? { ...slot, ...patch } : slot));
    });
  }, []);

  const runBulkEvaluation = useCallback(
    async (files: File[]) => {
      if (!activeTypeId || bulkRunning || files.length === 0) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = crypto.randomUUID();
      sessionIdsRef.current = [];

      setBulkRunning(true);
      setBulkAgents([]);
      initRowsFromFiles(files);

      let completed = 0;
      let failed = 0;

      const bulkConfig = await fetchBulkEvaluationConfig();
      const parallelProjects = bulkConfig.parallelProjects;
      let sharedKnowledgeChunks: StoredChunk[] | undefined;

      if (bulkConfig.useClientKnowledgeIndex && bulkConfig.preloadKnowledgeOnBulkStart) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Precargando índice de referencia en memoria…",
          },
        ]);
        const loaded = await ensureKnowledgeIndex(activeTypeId, (p) => {
          if (p.message) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && last.content.startsWith("Precargando")) {
                const next = [...prev];
                next[next.length - 1] = { ...last, content: p.message! };
                return next;
              }
              return [...prev, { role: "assistant", content: p.message! }];
            });
          }
        });
        sharedKnowledgeChunks = loaded.chunks;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Iniciando evaluación masiva de ${files.length} proyecto(s) en grupos de ${parallelProjects}…`,
        },
      ]);

      const processProject = async (file: File, index: number): Promise<void> => {
        const rowId = rowIdForFile(index, file.name);
        const sessionId = `bulk-${runId}-${index}`;
        sessionIdsRef.current.push(sessionId);

        const syncAgent = (
          status: BulkAgentSlotStatus,
          trace: AgentTraceEntry[],
          extra?: Partial<BulkAgentSlot>
        ) => {
          patchAgentSlot(rowId, {
            status,
            trace,
            streamLine: getLastStreamLine(trace),
            ...extra,
          });
        };

        patchAgentSlot(rowId, {
          rowId,
          slotIndex: index,
          projectName: fileBaseName(file.name),
          fileName: file.name,
          status: "extracting",
          trace: [],
          streamLine: "Subiendo archivo…",
        });
        updateRow(rowId, { extractionStatus: "running", evaluationStatus: "pending" });

        try {
          const extractResult = await extractWithFile(
            file,
            sessionId,
            activeTypeId,
            controller.signal,
            (trace) => syncAgent("extracting", trace)
          );

          const elementsTable = extractResult.elementsTable.map((r) => ({
            element: r.element,
            content: r.content,
          }));
          const projectName = extractProjectName(elementsTable, file.name);
          updateRow(rowId, {
            extractionStatus: "done",
            projectName,
            elementsTable,
            evaluationStatus: "running",
          });
          patchAgentSlot(rowId, { projectName, status: "evaluating" });

          const evalResult = await runEvaluateStream({
            evaluationTypeId: activeTypeId,
            projectElementsTable: elementsTable,
            knowledgeChunks: sharedKnowledgeChunks,
            onTraceUpdate: (trace) => syncAgent("evaluating", trace),
            onScoresUpdate: ({ subdimensionScores, overallScore }) => {
              updateRow(rowId, {
                subdimensionScores,
                ...(overallScore != null ? { overallScore } : {}),
              });
            },
            signal: controller.signal,
          });

          updateRow(rowId, {
            evaluationStatus: "done",
            subdimensionScores: evalResult.subdimensionScores,
            overallScore: evalResult.overallScore,
            reportContent: evalResult.reportContent,
            summary: evalResult.evaluationSummary,
          });

          if (!evalResult.reportComplete) {
            throw new Error("Informe incompleto tras la evaluación.");
          }

          patchAgentSlot(rowId, {
            status: "done",
            trace: evalResult.trace,
            streamLine: "Evaluación finalizada con éxito.",
          });
          completed++;
        } catch (e) {
          if (controller.signal.aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          failed++;
          setBulkRows((prev) =>
            prev.map((r) => {
              if (r.id !== rowId) return r;
              const patch: Partial<BulkProjectRow> = { errorMessage: msg };
              if (r.extractionStatus === "running") patch.extractionStatus = "error";
              else if (r.evaluationStatus === "running") patch.evaluationStatus = "error";
              else if (r.extractionStatus === "pending") patch.extractionStatus = "error";
              else patch.evaluationStatus = "error";
              return { ...r, ...patch };
            })
          );
          patchAgentSlot(rowId, {
            status: "error",
            errorMessage: msg,
            streamLine: msg,
          });
        } finally {
          void cleanupSession(sessionId);
        }
      };

      for (let batchStart = 0; batchStart < files.length; batchStart += parallelProjects) {
        if (controller.signal.aborted) break;

        const batch = files.slice(batchStart, batchStart + parallelProjects);
        setBulkAgents((prev) => {
          const incoming: BulkAgentSlot[] = batch.map((file, i) => ({
            rowId: rowIdForFile(batchStart + i, file.name),
            slotIndex: batchStart + i,
            projectName: fileBaseName(file.name),
            fileName: file.name,
            status: "pending",
            trace: [],
            streamLine: "En cola…",
          }));
          const existing = new Set(prev.map((s) => s.rowId));
          return [...prev, ...incoming.filter((s) => !existing.has(s.rowId))];
        });

        await Promise.all(batch.map((file, i) => processProject(file, batchStart + i)));
      }

      setBulkRunning(false);
      abortRef.current = null;
      releasePinnedKnowledgeIndex();

      if (!controller.signal.aborted) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Evaluación masiva finalizada: ${completed} completado(s), ${failed} con error(es).`,
          },
        ]);
      }
    },
    [activeTypeId, bulkRunning, initRowsFromFiles, updateRow, patchAgentSlot, setMessages]
  );

  return {
    bulkRows,
    bulkAgents,
    bulkRunning,
    runBulkEvaluation,
    resetBulk,
    cancelBulk,
    initRowsFromFiles,
  };
}
