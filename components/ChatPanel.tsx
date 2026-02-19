"use client";

import { useState, useRef } from "react";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Elimina bloques <think>...</think> del texto para no mostrarlos en el chat. */
function stripThinkBlocks(text: string): string {
  if (!text || typeof text !== "string") return text;
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<think>[\s\S]*$/i, "");
  return out.trim();
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
  sessionId: string;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeTypeId || loading) return;
    setInput("");
    onMessagesChange((prev) => [...prev, { role: "user", content: text }]);
    onMessagesChange((prev) => [...prev, { role: "assistant", content: "" }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluationTypeId: activeTypeId,
          message: text,
          projectFilePaths,
          projectElementsTable: projectElementsTable?.length ? projectElementsTable : undefined,
          messages: messages.slice(0, -1),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || res.statusText);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          onMessagesChange((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, content: stripThinkBlocks(accumulated) };
            return next;
          });
        }
      }
    } catch (e) {
      onMessagesChange((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, content: `[Error: ${e instanceof Error ? e.message : String(e)}]` };
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
          projectFilePaths,
          projectElementsTable: projectElementsTable?.length ? projectElementsTable : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || res.statusText);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          onReportContentChange(stripThinkBlocks(accumulated));
        }
      }
      onMessagesChange((prev) => [...prev, { role: "assistant", content: "Informe listo en el panel derecho." }]);
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
            className={`mb-3 rounded-lg px-3 py-2 ${
              m.role === "user"
                ? "ml-8 bg-gray-200 dark:bg-gray-700"
                : "mr-8 bg-gray-100 dark:bg-gray-800"
            }`}
          >
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {m.role === "user" ? "Usuario" : "Evaluador"}
            </span>
            <div className="mt-1 whitespace-pre-wrap break-words text-sm">
              {!m.content && loading && i === messages.length - 1 ? (
                <span className="inline-block animate-pulse">…</span>
              ) : (
                m.content || "…"
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
