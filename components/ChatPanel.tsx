"use client";

import { useState, useRef } from "react";
import type { ProjectStructuredData } from "@/lib/build-context";
import AgentTrace from "@/components/AgentTrace";
import type { AgentTraceEntry } from "@/lib/agent-events";
import {
  applyChatStreamEvent,
  createChatStreamState,
  parseNdjsonLine,
} from "@/lib/chat-stream";
import { createStaggeredTraceReveal } from "@/lib/trace-reveal";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  trace?: AgentTraceEntry[];
  traceRevealing?: boolean;
};

/** Elimina bloques <think>...</think> del texto para no mostrarlos en el chat. */
function stripThinkBlocks(text: string): string {
  if (!text || typeof text !== "string") return text;
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<think>[\s\S]*$/i, "");
  return out.trim();
}

/** Icono de carga animado (spinner). */
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
  reportContent,
  onReportContentChange,
  activeTypeId,
  projectFilePaths,
  onProjectFilePathsChange,
  projectElementsTable,
  projectStructuredData,
  sessionId,
}: {
  messages: ChatMessage[];
  onMessagesChange: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  reportContent: string;
  onReportContentChange: (content: string) => void;
  activeTypeId: number | null;
  projectFilePaths: string[];
  onProjectFilePathsChange: (paths: string[]) => void;
  projectElementsTable: { element: string; content: string }[];
  projectStructuredData?: ProjectStructuredData;
  sessionId: string;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const traceRevealRef = useRef<ReturnType<typeof createStaggeredTraceReveal> | null>(null);

  const CHAT_TIMEOUT_MS = 120_000;

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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluationTypeId: activeTypeId,
          sessionId,
          message: text,
          projectFilePaths,
          projectElementsTable: projectElementsTable?.length ? projectElementsTable : undefined,
          projectStructuredData: projectStructuredData ?? undefined,
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
        reveal.flushAll();
        onMessagesChange((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              content: "[Sin respuesta del evaluador. Intenta de nuevo.]",
              trace: streamState.trace,
              traceRevealing: false,
            };
          }
          return next;
        });
      }
    } catch (e) {
      clearTimeout(timeoutId);
      traceRevealRef.current?.flushAll();
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = msg.includes("abort") || msg.includes("timeout");
      onMessagesChange((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: isTimeout
              ? "[Tiempo de espera agotado. El evaluador tardó demasiado.]"
              : `[Error: ${msg}]`,
            traceRevealing: false,
          };
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEvaluate = async () => {
    if (!activeTypeId || evaluating) return;
    onMessagesChange((prev) => [...prev, { role: "assistant", content: "Generando informe de evaluación…" }]);
    setEvaluating(true);
    onReportContentChange("");
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluationTypeId: activeTypeId,
          projectElementsTable: projectElementsTable?.length ? projectElementsTable : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err?.message || err?.error || res.statusText;
        throw new Error(message);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reportContent = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const data = JSON.parse(trimmed) as { type: string; message?: string; chunk?: string; error?: string };
              if (data.type === "step" && typeof data.message === "string") {
                onMessagesChange((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant") next[next.length - 1] = { ...last, content: data.message! };
                  else next.push({ role: "assistant", content: data.message! });
                  return next;
                });
              } else if (data.type === "content" && typeof data.chunk === "string") {
                reportContent += data.chunk;
                onReportContentChange(stripThinkBlocks(reportContent));
              } else if (data.type === "done") {
                onMessagesChange((prev) => [...prev, { role: "assistant", content: "Informe listo en el panel derecho." }]);
              } else if (data.type === "error" && data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer.trim()) as { type: string; message?: string; chunk?: string; error?: string };
            if (data.type === "step" && typeof data.message === "string") {
              onMessagesChange((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") next[next.length - 1] = { ...last, content: data.message! };
                return next;
              });
            } else if (data.type === "content" && typeof data.chunk === "string") {
              reportContent += data.chunk;
              onReportContentChange(stripThinkBlocks(reportContent));
            } else if (data.type === "done") {
              onMessagesChange((prev) => [...prev, { role: "assistant", content: "Informe listo en el panel derecho." }]);
            } else if (data.type === "error" && data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e) {
      onMessagesChange((prev) => [...prev, { role: "assistant", content: `[Error: ${e instanceof Error ? e.message : String(e)}]` }]);
    } finally {
      setEvaluating(false);
    }
  };

  const handleUploadProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("kind", "project");
      form.set("sessionId", sessionId);
      for (let i = 0; i < files.length; i++) form.append("files", files[i]);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Error subiendo archivos");
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.paths) && data.paths.length) {
        onProjectFilePathsChange([...projectFilePaths, ...data.paths]);
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  /** Nombre visible del archivo (sin prefijo de sesión si existe). */
  const displayName = (path: string) => path.replace(/^[^/]+\//, "") || path;

  return (
    <div className="flex h-full flex-col bg-gray-50 dark:bg-[#1e1e1e]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeTypeId
              ? "Escriba un mensaje o suba documentos del proyecto y pulse Evaluar."
              : "Seleccione un tipo de evaluación o cree uno en Configuración."}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
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
              {m.role === "assistant" &&
              (m.trace?.length || m.traceRevealing || (loading && i === messages.length - 1)) ? (
                <div className="mt-1.5">
                  <AgentTrace
                    entries={m.trace ?? []}
                    isActive={(loading || m.traceRevealing) && i === messages.length - 1}
                    isRevealing={!!m.traceRevealing}
                  />
                </div>
              ) : null}
              {(m.content ||
                (m.role === "assistant" &&
                  !m.content &&
                  (loading || m.traceRevealing) &&
                  i === messages.length - 1)) && (
                <div className="mt-1 flex items-center gap-2 whitespace-pre-wrap break-words text-sm">
                  {m.role === "assistant" &&
                  !m.content &&
                  (loading || m.traceRevealing) &&
                  i === messages.length - 1 ? (
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
        ))}
      </div>
      {projectFilePaths.length > 0 && (
        <div className="shrink-0 border-t border-gray-200 px-4 py-1.5 dark:border-gray-700">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Archivos del proyecto ({projectFilePaths.length}):
            </span>
            {projectFilePaths.map((path, idx) => (
              <span
                key={path}
                className="inline-flex max-w-[180px] items-center gap-1 rounded bg-gray-100 py-0.5 pl-1.5 pr-0.5 dark:bg-gray-700/80"
                title={path}
              >
                <span className="min-w-0 truncate text-xs text-gray-600 dark:text-gray-300">
                  {displayName(path)}
                </span>
                <button
                  type="button"
                  onClick={() => onProjectFilePathsChange(projectFilePaths.filter((_, i) => i !== idx))}
                  className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                  title="Quitar archivo"
                  aria-label="Quitar archivo"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
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
          disabled={!activeTypeId || loading}
        />
        <button
          type="button"
          onClick={handleEvaluate}
          disabled={!activeTypeId || evaluating}
          className="rounded-full bg-[#4b5563] px-4 py-2 text-sm font-medium text-white hover:bg-[#374151] focus:outline-none focus:ring-2 focus:ring-gray-500 dark:bg-[#6b7280] dark:hover:bg-[#4b5563] disabled:opacity-50"
        >
          Evaluar
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!activeTypeId || uploading}
          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-600 dark:bg-[#374151] dark:text-gray-200 dark:hover:bg-[#4b5563] disabled:opacity-50"
        >
          {uploading ? "Subiendo…" : "Subir archivos"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json"
          className="hidden"
          onChange={handleUploadProject}
        />
      </div>
    </div>
  );
}
