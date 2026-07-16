"use client";

import { useState, useRef } from "react";
import AgentTrace from "@/components/AgentTrace";
import BulkAgentPanel, { type BulkAgentSlot } from "@/components/BulkAgentPanel";
import type { BulkProjectRow } from "@/hooks/useBulkEvaluation";
import type { RubricScoreSchemaEntry } from "@/lib/evaluation-scores";
import { buildBulkEvaluationChatContext } from "@/lib/bulk-chat-context";
import { buildBulkChatProjects } from "@/lib/bulk-chat-types";
import type { AgentTraceEntry } from "@/lib/agent-events";
import {
  applyChatStreamEvent,
  createChatStreamState,
  parseNdjsonLine,
} from "@/lib/chat-stream";
import { retrieveKnowledgeForChat } from "@/lib/chat-client-rag";
import { isLikelyKnowledgeChatMessage } from "@/lib/chat-intent-client";
import { fetchBulkEvaluationConfig } from "@/lib/bulk-evaluation-config-client";
import { createStaggeredTraceReveal } from "@/lib/trace-reveal";
import { countBulkIgnoredFiles, filterBulkProjectFiles } from "@/lib/evaluation-mode";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  trace?: AgentTraceEntry[];
  traceRevealing?: boolean;
};

function stripThinkBlocks(text: string): string {
  if (!text || typeof text !== "string") return text;
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<think>[\s\S]*$/i, "");
  return out.trim();
}

function LoadingSpinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-gray-500 dark:text-gray-400 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default function ChatPanel({
  messages,
  onMessagesChange,
  activeTypeId,
  bulkFiles = [],
  onBulkFilesChange,
  bulkRunning = false,
  bulkAgents = [],
  bulkRows = [],
  bulkScoreSchema = [],
  onBulkEvaluate,
}: {
  messages: ChatMessage[];
  onMessagesChange: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  activeTypeId: number | null;
  bulkFiles?: File[];
  onBulkFilesChange?: (files: File[]) => void;
  bulkRunning?: boolean;
  bulkAgents?: BulkAgentSlot[];
  bulkRows?: BulkProjectRow[];
  bulkScoreSchema?: RubricScoreSchemaEntry[];
  onBulkEvaluate?: () => void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const traceRevealRef = useRef<ReturnType<typeof createStaggeredTraceReveal> | null>(null);

  const CHAT_TIMEOUT_MS = 180_000;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeTypeId || loading) return;
    setInput("");
    onMessagesChange((prev) => [...prev, { role: "user", content: text }]);
    onMessagesChange((prev) => [
      ...prev,
      { role: "assistant", content: "", trace: [], traceRevealing: true },
    ]);
    traceRevealRef.current?.destroy();
    const reveal = createStaggeredTraceReveal((revealed) => {
      onMessagesChange((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: revealed.content,
            trace: revealed.trace,
            traceRevealing: revealed.revealing,
          };
        }
        return next;
      });
    });
    traceRevealRef.current = reveal;
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
      const bulkProjects = buildBulkChatProjects(bulkRows);
      const bulkEvaluationContext =
        bulkProjects.length > 0
          ? buildBulkEvaluationChatContext(bulkRows, bulkScoreSchema, { userMessage: text })
          : undefined;

      let precomputedKnowledgeChunks;
      let clientRagEnabled = false;
      try {
        const bulkCfg = await fetchBulkEvaluationConfig();
        if (bulkCfg.useClientKnowledgeIndex && isLikelyKnowledgeChatMessage(text)) {
          clientRagEnabled = true;
          precomputedKnowledgeChunks = await retrieveKnowledgeForChat(activeTypeId, text);
        }
      } catch {
        /* fallback servidor */
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluationTypeId: activeTypeId,
          sessionId: "default",
          message: text,
          projectFilePaths: [],
          bulkEvaluationContext,
          bulkProjects: bulkProjects.length > 0 ? bulkProjects : undefined,
          precomputedKnowledgeChunks,
          clientRagEnabled,
          messages: messages.slice(0, -1),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.message || err?.error || res.statusText;
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamState = createChatStreamState();

      const syncAssistant = (live: boolean) => {
        const trace = streamState.trace.map((t) => ({ ...t, live: live && t.live }));
        reveal.setState(trace, stripThinkBlocks(streamState.content));
      };

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = parseNdjsonLine(line);
            if (!event) continue;
            if (event.type === "error") throw new Error(event.error);
            streamState = applyChatStreamEvent(streamState, event, true);
            syncAssistant(true);
          }
        }
        if (buffer.trim()) {
          const event = parseNdjsonLine(buffer);
          if (event) {
            if (event.type === "error") throw new Error(event.error);
            streamState = applyChatStreamEvent(streamState, event, false);
          }
        }
        streamState = applyChatStreamEvent(streamState, { type: "done" }, false);
        syncAssistant(false);
      }

      const final = stripThinkBlocks(streamState.content);
      if (!final.trim()) {
        onMessagesChange((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              content: "[Sin respuesta del modelo]",
              traceRevealing: false,
            };
          }
          return next;
        });
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? "La solicitud tardó demasiado. Intente de nuevo."
            : e.message
          : String(e);
      onMessagesChange((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: `[Error: ${msg}]`,
            traceRevealing: false,
          };
        } else {
          next.push({ role: "assistant", content: `[Error: ${msg}]` });
        }
        return next;
      });
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      traceRevealRef.current?.flushAll();
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !onBulkFilesChange) return;
    const all = Array.from(files);
    const filtered = filterBulkProjectFiles(all);
    const ignored = countBulkIgnoredFiles(all);
    onBulkFilesChange(filtered);

    if (filtered.length === 0) {
      onMessagesChange((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "No se encontraron proyectos válidos en la carpeta (se requieren archivos Excel, PDF o Word).",
        },
      ]);
    } else {
      const ignoredNote =
        ignored > 0
          ? ` Se omitieron ${ignored} archivo(s) auxiliar(es) del sistema (p. ej. ~$ de Excel u ocultos). El aviso del navegador puede contar más archivos de los que se evaluarán.`
          : "";
      onMessagesChange((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Carpeta cargada: ${filtered.length} proyecto(s) listo(s) para evaluar.${ignoredNote}`,
        },
      ]);
    }
    e.target.value = "";
  };

  const isBulkCompletionMessage = (content: string) =>
    content.includes("Evaluación masiva finalizada");

  const bulkCompletionIndex = messages.findIndex(
    (m) => m.role === "assistant" && isBulkCompletionMessage(m.content)
  );

  const bulkIntroMessages =
    bulkCompletionIndex >= 0 ? messages.slice(0, bulkCompletionIndex) : messages;
  const bulkOutroMessages =
    bulkCompletionIndex >= 0 ? messages.slice(bulkCompletionIndex) : [];

  const useBulkAgentPanels = bulkAgents.length > 0;

  const isBulkStatusMessage = (content: string) =>
    content.includes("Iniciando evaluación masiva") ||
    content.includes("Evaluación masiva finalizada") ||
    content.startsWith("Carpeta cargada:");

  const renderChatMessage = (m: ChatMessage, i: number, isLastInSection: boolean) => {
    const isBulkInteractiveReply =
      m.role === "assistant" &&
      (m.traceRevealing || (m.trace != null && m.trace.length > 0));

    const allowBulkAgentUi =
      isBulkInteractiveReply ||
      (loading && isLastInSection && m.role === "assistant" && !isBulkStatusMessage(m.content));

    const showMessageAgentTrace =
      m.role === "assistant" &&
      allowBulkAgentUi &&
      (m.trace?.length || m.traceRevealing || (loading && isLastInSection));

    const showMessageSpinner =
      m.role === "assistant" &&
      !m.content &&
      allowBulkAgentUi &&
      isLastInSection &&
      (loading || bulkRunning || m.traceRevealing);

    return (
      <div
        key={`msg-${i}-${m.role}-${m.content.slice(0, 24)}`}
        className={`mb-3 flex min-w-0 max-w-full ${m.role === "user" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`min-w-0 max-w-[85%] rounded-lg px-3 py-2 ${
            m.role === "user"
              ? "bg-gray-200 dark:bg-gray-700"
              : "bg-gray-100 dark:bg-gray-800"
          }`}
        >
          <span
            className={`text-xs font-medium ${
              m.role === "user"
                ? "text-blue-600 dark:text-blue-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {m.role === "user" ? "Usuario" : "Evaluador"}
          </span>
          {showMessageAgentTrace ? (
            <div className="mt-1.5 min-w-0 max-w-full overflow-hidden">
              <AgentTrace
                entries={m.trace ?? []}
                isActive={(loading || bulkRunning || m.traceRevealing) && isLastInSection}
                isRevealing={!!m.traceRevealing}
              />
            </div>
          ) : null}
          {(m.content || showMessageSpinner) && (
            <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden break-words text-sm whitespace-pre-wrap">
              {showMessageSpinner ? (
                <>
                  <LoadingSpinner />
                  <span className="text-gray-500 dark:text-gray-400">
                    {m.traceRevealing
                      ? "Analizando…"
                      : m.trace?.length
                        ? "Generando respuesta…"
                        : "Respondiendo…"}
                  </span>
                </>
              ) : (
                m.content
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-gray-50 dark:bg-[#1e1e1e]">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-3">
        {messages.length === 0 && !useBulkAgentPanels && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeTypeId
              ? "Elija una carpeta con proyectos y pulse Evaluar para iniciar la evaluación masiva."
              : "Seleccione un tipo de evaluación o cree uno en Configuración."}
          </p>
        )}
        {bulkIntroMessages.map((m, i) =>
          renderChatMessage(m, i, i === bulkIntroMessages.length - 1 && !useBulkAgentPanels)
        )}
        {useBulkAgentPanels && <BulkAgentPanel agents={bulkAgents} />}
        {bulkOutroMessages.map((m, i) =>
          renderChatMessage(m, bulkIntroMessages.length + i, i === bulkOutroMessages.length - 1)
        )}
      </div>
      {bulkFiles.length > 0 && (
        <div className="shrink-0 border-t border-gray-200 px-4 py-1.5 dark:border-gray-700">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Proyectos en carpeta ({bulkFiles.length}):
            </span>
            {bulkFiles.slice(0, 5).map((file) => (
              <span
                key={file.name}
                className="inline-flex max-w-[180px] items-center rounded bg-gray-100 py-0.5 px-1.5 dark:bg-gray-700/80"
                title={file.name}
              >
                <span className="min-w-0 truncate text-xs text-gray-600 dark:text-gray-300">
                  {file.name}
                </span>
              </span>
            ))}
            {bulkFiles.length > 5 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                +{bulkFiles.length - 5} más
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Chat"
          className="min-w-[200px] flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          disabled={!activeTypeId || loading || bulkRunning}
        />
        <button
          type="button"
          onClick={() => onBulkEvaluate?.()}
          disabled={!activeTypeId || bulkRunning || bulkFiles.length === 0}
          className="rounded-full bg-btn-primary-bg px-4 py-2 text-sm font-medium text-btn-primary-fg hover:bg-btn-primary-hover focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
        >
          {bulkRunning ? "Evaluando…" : "Evaluar"}
        </button>
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          disabled={!activeTypeId || bulkRunning}
          className="rounded-full border border-btn-secondary-border bg-btn-secondary-bg px-4 py-2 text-sm font-medium text-btn-secondary-fg hover:bg-btn-secondary-hover focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
        >
          Elegir carpeta
        </button>
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory no está en tipos estándar
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFolderSelect}
        />
      </div>
    </div>
  );
}
