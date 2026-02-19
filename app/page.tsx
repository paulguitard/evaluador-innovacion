"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import ChatPanel from "@/components/ChatPanel";
import ReportPanel from "@/components/ReportPanel";
import ConfigPanel from "@/components/ConfigPanel";
import FullscreenOverlay, { ExpandIcon } from "@/components/FullscreenOverlay";
import type { ChatMessage } from "@/components/ChatPanel";

type EvaluationType = { id: number; name: string };

const SESSION_ID = "default";

/** Parsea líneas "Elemento | Contenido" (o "Elemento|Contenido") y devuelve filas, sin repetir elemento (primera aparición). */
function parseElementoContenido(text: string): [string, string][] {
  const rows: [string, string][] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let t = line.trim().replace(/^\|/, "").trim();
    const sep = t.includes(" | ") ? " | " : "|";
    const idx = t.indexOf(sep);
    if (idx >= 0) {
      const elemento = t.slice(0, idx).trim();
      const contenido = t.slice(idx + sep.length).trim().replace(/\|+$/, "").trim();
      if (!elemento) continue;
      const key = elemento.toLowerCase();
      if (seen.has(key)) continue;
      if (key === "elemento" && contenido.toLowerCase() === "contenido") continue;
      seen.add(key);
      rows.push([elemento, contenido || "—"]);
    }
  }
  return rows;
}

export default function Home() {
  const [evaluationTypes, setEvaluationTypes] = useState<EvaluationType[]>([]);
  const [activeTypeId, setActiveTypeId] = useState<number | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reportContent, setReportContent] = useState("");
  const [reportTitle, setReportTitle] = useState("TITULO DEL INFORME DE EVALUACIÓN");
  const [projectFilePaths, setProjectFilePaths] = useState<string[]>([]);
  const [extractedProjectText, setExtractedProjectText] = useState("");
  const [extractedProjectTable, setExtractedProjectTable] = useState<{ element: string; content: string }[]>([]);
  const [extractedProjectLoading, setExtractedProjectLoading] = useState(false);
  const [projectSectionOpen, setProjectSectionOpen] = useState(true);
  const [fullscreenSection, setFullscreenSection] = useState<"project" | "report" | null>(null);

  useEffect(() => {
    fetch("/api/evaluation-types")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setEvaluationTypes(data);
          if (data.length > 0 && !activeTypeId) setActiveTypeId(data[0].id);
        }
      })
      .catch(() => {});
  }, [configOpen]);

  useEffect(() => {
    const t = evaluationTypes.find((x) => x.id === activeTypeId);
    setReportTitle(t ? `Informe: ${t.name}` : "TITULO DEL INFORME DE EVALUACIÓN");
  }, [activeTypeId, evaluationTypes]);

  useEffect(() => {
    if (projectFilePaths.length === 0) {
      setExtractedProjectText("");
      setExtractedProjectTable([]);
      setExtractedProjectLoading(false);
      return;
    }
    setExtractedProjectLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "Extrayendo información…" }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "Detectando y organizando…" }]);

    const abortController = new AbortController();
    fetch("/api/project-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectFilePaths,
        evaluationTypeId: activeTypeId ?? undefined,
        stream: true,
      }),
      signal: abortController.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || res.statusText);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        let buffer = "";
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
              const data = JSON.parse(trimmed) as {
                type: string;
                name?: string;
                text?: string;
                error?: string;
                elementsTable?: { element: string; content: string }[];
              };
              if (data.type === "element" && typeof data.name === "string") {
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === "assistant" && last.content.startsWith("Detectando")) {
                    const sep = last.content.endsWith("…") ? "\n\n" : "\n";
                    next[next.length - 1] = { ...last, content: last.content + sep + data.name + " ✓" };
                  }
                  return next;
                });
              } else if (data.type === "done") {
                const text = typeof data.text === "string" ? data.text : "";
                const table = Array.isArray(data.elementsTable) ? data.elementsTable : [];
                setExtractedProjectText(text);
                setExtractedProjectTable(table);
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
            const data = JSON.parse(buffer.trim()) as {
              type: string;
              text?: string;
              error?: string;
              elementsTable?: { element: string; content: string }[];
            };
            if (data.type === "done") {
              setExtractedProjectText(typeof data.text === "string" ? data.text : "");
              setExtractedProjectTable(Array.isArray(data.elementsTable) ? data.elementsTable : []);
            }
            if (data.type === "error" && data.error) throw new Error(data.error);
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      })
      .catch(() => {
        setExtractedProjectText("");
        setExtractedProjectTable([]);
      })
      .finally(() => {
        setMessages((prev) => [...prev, { role: "assistant", content: "Extracción completada." }]);
        setExtractedProjectLoading(false);
      });

    return () => abortController.abort();
  }, [projectFilePaths, activeTypeId]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-100 dark:bg-[#1e1e1e]">
      <Header
        types={evaluationTypes}
        activeId={activeTypeId}
        onSelect={setActiveTypeId}
        onOpenConfig={() => setConfigOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-gray-200 dark:border-gray-700">
          <ChatPanel
            messages={messages}
            onMessagesChange={setMessages}
            reportContent={reportContent}
            onReportContentChange={setReportContent}
            activeTypeId={activeTypeId}
            projectFilePaths={projectFilePaths}
            onProjectFilePathsChange={setProjectFilePaths}
            projectElementsTable={extractedProjectTable}
            sessionId={SESSION_ID}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className={`flex flex-col border-b border-gray-200 dark:border-gray-700 ${projectSectionOpen ? "min-h-0 flex-1" : "shrink-0"}`}
            >
              <div className="flex shrink-0 w-full items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setProjectSectionOpen((o) => !o)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-lg font-semibold text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:text-gray-100 dark:hover:bg-gray-800 dark:focus:ring-gray-600"
                >
                  <span className="text-gray-500 dark:text-gray-400" aria-hidden>
                    {projectSectionOpen ? "▼" : "▶"}
                  </span>
                  Proyecto extraído
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreenSection("project")}
                  className="shrink-0 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  title="Pantalla completa"
                  aria-label="Ver en pantalla completa"
                >
                  <ExpandIcon />
                </button>
              </div>
              {projectSectionOpen && (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
                  {extractedProjectLoading
                    ? "Extrayendo con IA…"
                    : (() => {
                        const rows =
                          extractedProjectTable.length > 0
                            ? extractedProjectTable.map((r) => [r.element, r.content] as [string, string])
                            : parseElementoContenido(extractedProjectText?.trim() || "");
                        if (rows.length === 0) {
                          const t = extractedProjectText?.trim() || "";
                          if (!t) return "Sube archivos del proyecto para ver aquí el texto extraído.";
                          return <pre className="whitespace-pre-wrap font-sans">{t}</pre>;
                        }
                        return (
                          <table className="w-full border-collapse border border-gray-300 dark:border-gray-600">
                            <thead>
                              <tr className="bg-gray-100 dark:bg-gray-800">
                                <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600">Elemento</th>
                                <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600">Contenido</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(([elem, cont], i) => (
                                <tr key={i} className="border-b border-gray-200 dark:border-gray-700">
                                  <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600">{elem}</td>
                                  <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600 whitespace-pre-wrap">{cont}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        );
                      })()}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 flex flex-col">
              <ReportPanel
              title={reportTitle}
              body={reportContent}
              onFullscreenRequest={() => setFullscreenSection("report")}
            />
            </div>
          </div>
        </div>
      </div>
      <ConfigPanel
        isOpen={configOpen}
        onClose={() => setConfigOpen(false)}
        types={evaluationTypes}
        activeId={activeTypeId}
        onTypesChange={() => fetch("/api/evaluation-types").then((r) => r.json()).then(setEvaluationTypes)}
        onSelectType={setActiveTypeId}
      />
      {fullscreenSection === "project" && (
        <FullscreenOverlay title="Proyecto extraído" onClose={() => setFullscreenSection(null)}>
          <div className="text-sm text-gray-800 dark:text-gray-200">
            {extractedProjectLoading
              ? "Extrayendo con IA…"
              : (() => {
                  const rows =
                    extractedProjectTable.length > 0
                      ? extractedProjectTable.map((r) => [r.element, r.content] as [string, string])
                      : parseElementoContenido(extractedProjectText?.trim() || "");
                  if (rows.length === 0) {
                    const t = extractedProjectText?.trim() || "";
                    if (!t) return "Sube archivos del proyecto para ver aquí el texto extraído.";
                    return <pre className="whitespace-pre-wrap font-sans">{t}</pre>;
                  }
                  return (
                    <table className="w-full border-collapse border border-gray-300 dark:border-gray-600">
                      <thead>
                        <tr className="bg-gray-100 dark:bg-gray-800">
                          <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600">Elemento</th>
                          <th className="border border-gray-300 px-3 py-2 text-left font-semibold dark:border-gray-600">Contenido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(([elem, cont], i) => (
                          <tr key={i} className="border-b border-gray-200 dark:border-gray-700">
                            <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600">{elem}</td>
                            <td className="border border-gray-300 px-3 py-2 align-top dark:border-gray-600 whitespace-pre-wrap">{cont}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
          </div>
        </FullscreenOverlay>
      )}
      {fullscreenSection === "report" && (
        <FullscreenOverlay title={reportTitle} onClose={() => setFullscreenSection(null)}>
          <div className="text-gray-800 dark:text-gray-200" style={{ whiteSpace: "pre-wrap" }}>
            {reportContent || "Cuerpo del informe de evaluación. Ejecute \"Evaluar\" para generar el informe."}
          </div>
        </FullscreenOverlay>
      )}
    </div>
  );
}
