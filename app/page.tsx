"use client";

import { useState, useEffect, useRef } from "react";
import Header from "@/components/Header";
import ChatPanel from "@/components/ChatPanel";
import ReportPanel from "@/components/ReportPanel";
import ConfigPanel from "@/components/ConfigPanel";
import FullscreenOverlay, { ExpandIcon } from "@/components/FullscreenOverlay";
import ProjectExtractedTable from "@/components/ProjectExtractedTable";
import type { ChatMessage } from "@/components/ChatPanel";
import type { AgentTraceEntry } from "@/lib/agent-events";
import type { ProjectStructuredData } from "@/lib/build-context";
import {
  applyExtractStreamEvent,
  createExtractStreamState,
  formatExtractCompletionMessage,
  knowledgePathsToLabels,
  parseExtractNdjsonLine,
} from "@/lib/extract-stream";
import type { ExtractStreamEvent } from "@/lib/project-extract-pipeline";
import { createStaggeredTraceReveal } from "@/lib/trace-reveal";

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
  const [extractedProjectTable, setExtractedProjectTable] = useState<
    { section?: string; element: string; content: string; incomplete?: boolean }[]
  >([]);
  const [extractedStructuredData, setExtractedStructuredData] = useState<ProjectStructuredData | null>(null);
  const [extractedProjectLoading, setExtractedProjectLoading] = useState(false);
  const [elementsWithSection, setElementsWithSection] = useState<{ title: string; section: string }[]>([]);
  const [knowledgeDocNames, setKnowledgeDocNames] = useState<string[]>([]);
  const [projectSectionOpen, setProjectSectionOpen] = useState(true);
  const [fullscreenSection, setFullscreenSection] = useState<"project" | "report" | null>(null);
  const prevActiveTypeIdRef = useRef<number | null>(null);
  const extractRevealRef = useRef<ReturnType<typeof createStaggeredTraceReveal> | null>(null);
  const knowledgeDocNamesRef = useRef<string[]>([]);
  const extractCompletionPendingRef = useRef<string | null>(null);
  const extractTraceMsgIndexRef = useRef(-1);
  const extractFullTraceRef = useRef<AgentTraceEntry[]>([]);

  /** Al cambiar de tipo de evaluación, limpiar la UI principal (chat, informe, proyecto). */
  useEffect(() => {
    if (activeTypeId == null) return;
    if (prevActiveTypeIdRef.current != null && prevActiveTypeIdRef.current !== activeTypeId) {
      setMessages([]);
      setReportContent("");
      setProjectFilePaths([]);
      setExtractedProjectText("");
      setExtractedProjectTable([]);
      setExtractedStructuredData(null);
      setExtractedProjectLoading(false);
      setFullscreenSection(null);
    }
    prevActiveTypeIdRef.current = activeTypeId;
  }, [activeTypeId]);

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
    knowledgeDocNamesRef.current = knowledgeDocNames;
  }, [knowledgeDocNames]);

  useEffect(() => {
    if (!activeTypeId) {
      setElementsWithSection([]);
      setKnowledgeDocNames([]);
      return;
    }
    const loadConfig = () => {
      fetch(`/api/config/${activeTypeId}`)
        .then((r) => r.json())
        .then((data) => {
          const elements = Array.isArray(data.elements) ? data.elements : [];
          const mapped = elements
            .filter((e: unknown) => typeof e === "object" && e != null && "title" in e)
            .map((e: { title?: string; section?: string }) => ({
              title: String((e as { title: string }).title ?? "").trim(),
              section: typeof (e as { section?: string }).section === "string" ? ((e as { section: string }).section ?? "General").trim() : "General",
            }))
            .filter((e: { title: string }) => e.title);
          setElementsWithSection(mapped);
          const paths = Array.isArray(data.knowledge_paths) ? data.knowledge_paths : [];
          setKnowledgeDocNames(knowledgePathsToLabels(paths));
        })
        .catch(() => {
          setElementsWithSection([]);
          setKnowledgeDocNames([]);
        });
    };
    loadConfig();
  }, [activeTypeId, configOpen]);

  const MAX_EXTRACT_RETRIES = 5;
  const EXTRACT_RETRY_DELAY_MS = 3000;

  useEffect(() => {
    if (projectFilePaths.length === 0) {
      setExtractedProjectText("");
      setExtractedProjectTable([]);
      setExtractedStructuredData(null);
      setExtractedProjectLoading(false);
      return;
    }

    let cancelled = false;
    let currentController: AbortController | null = null;

    const applyDonePayload = (event: Extract<ExtractStreamEvent, { type: "done" }>) => {
      const text = typeof event.text === "string" ? event.text : "";
      const table = Array.isArray(event.elementsTable)
        ? event.elementsTable.map((r) => ({
            section: r.section,
            element: r.element,
            content: r.content,
            incomplete: r.incomplete,
          }))
        : [];
      const sd = event.structuredData;
      setExtractedProjectText(text);
      setExtractedProjectTable(table);
      setExtractedStructuredData(sd && "files" in sd && sd.files?.length ? sd : null);
      setExtractedProjectLoading(false);
    };

    const appendExtractCompletion = () => {
      const msg = extractCompletionPendingRef.current;
      if (!msg) return;
      extractCompletionPendingRef.current = null;
      const fullTrace = extractFullTraceRef.current;

      setMessages((prev) => {
        const next = [...prev];
        const traceIdx = extractTraceMsgIndexRef.current;
        if (traceIdx >= 0 && traceIdx < next.length && next[traceIdx]?.role === "assistant") {
          next[traceIdx] = {
            ...next[traceIdx],
            trace: fullTrace.map((t) => ({ ...t, live: false })),
            traceRevealing: false,
            content: "",
          };
        }
        const alreadyHas = next.some(
          (m, i) =>
            i !== traceIdx &&
            m.role === "assistant" &&
            m.content === msg &&
            !(m.trace?.length || m.traceRevealing)
        );
        if (!alreadyHas) {
          next.push({ role: "assistant", content: msg });
        }
        return next;
      });

      extractRevealRef.current?.destroy();
      extractRevealRef.current = null;
      extractTraceMsgIndexRef.current = -1;
    };

    const startExtractMessage = () => {
      extractRevealRef.current?.destroy();
      extractTraceMsgIndexRef.current = -1;
      extractFullTraceRef.current = [];
      const reveal = createStaggeredTraceReveal((revealed) => {
        setMessages((prev) => {
          const next = [...prev];
          const traceIdx = extractTraceMsgIndexRef.current;
          if (traceIdx < 0 || traceIdx >= next.length || next[traceIdx]?.role !== "assistant") {
            return next;
          }
          next[traceIdx] = {
            ...next[traceIdx],
            content: "",
            trace: revealed.trace,
            traceRevealing: revealed.revealing,
          };
          return next;
        });
        if (!revealed.revealing && extractCompletionPendingRef.current) {
          appendExtractCompletion();
        }
      });
      reveal.onFullyRevealed(() => {
        if (extractCompletionPendingRef.current) {
          appendExtractCompletion();
        }
      });
      extractRevealRef.current = reveal;
      setMessages((prev) => {
        const next: ChatMessage[] = [
          ...prev,
          { role: "assistant", content: "", trace: [], traceRevealing: true },
        ];
        extractTraceMsgIndexRef.current = next.length - 1;
        return next;
      });
      return reveal;
    };

    const processExtractEvent = (
      event: ExtractStreamEvent,
      streamState: ReturnType<typeof createExtractStreamState>,
      reveal: ReturnType<typeof createStaggeredTraceReveal>,
      live: boolean
    ) => {
      if (event.type === "error") throw new Error(event.error);
      const nextState = applyExtractStreamEvent(streamState, event, live);
      const trace = nextState.trace.map((t) => ({ ...t, live: live && t.live }));
      extractFullTraceRef.current = trace;
      if (event.type === "done") {
        extractCompletionPendingRef.current = formatExtractCompletionMessage(
          knowledgeDocNamesRef.current
        );
        applyDonePayload(event);
      }
      reveal.setState(trace, "");
      return nextState;
    };

    const doFetch = (attempt: number) => {
      if (cancelled) return;
      extractCompletionPendingRef.current = null;
      const reveal = startExtractMessage();
      let streamState = createExtractStreamState();
      currentController = new AbortController();
      fetch("/api/project-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectFilePaths,
          evaluationTypeId: activeTypeId ?? undefined,
          sessionId: SESSION_ID,
          stream: true,
        }),
        signal: currentController.signal,
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
              const event = parseExtractNdjsonLine(line);
              if (!event) continue;
              streamState = processExtractEvent(event, streamState, reveal, true);
            }
          }
          if (buffer.trim()) {
            const event = parseExtractNdjsonLine(buffer);
            if (event) {
              streamState = processExtractEvent(event, streamState, reveal, false);
            }
          }
          if (!extractCompletionPendingRef.current) {
            extractCompletionPendingRef.current = formatExtractCompletionMessage(
              knowledgeDocNamesRef.current
            );
            streamState = applyExtractStreamEvent(streamState, { type: "done", text: "" }, false);
            extractFullTraceRef.current = streamState.trace;
            reveal.setState(streamState.trace, "");
          }
          if (extractCompletionPendingRef.current) {
            reveal.onFullyRevealed(() => {
              if (extractCompletionPendingRef.current) {
                appendExtractCompletion();
              }
            });
          }
        })
        .catch((err) => {
          extractCompletionPendingRef.current = null;
          extractRevealRef.current?.flushAll();
          setExtractedProjectText("");
          setExtractedProjectTable([]);
          setExtractedStructuredData(null);
          const msg = err?.message?.includes("429")
            ? "Extracción fallida: límite de uso temporal. Reintente en unos momentos."
            : "Extracción fallida.";
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.traceRevealing) {
              next[next.length - 1] = {
                ...last,
                content: msg,
                traceRevealing: false,
              };
            } else {
              next.push({ role: "assistant", content: msg });
            }
            return next;
          });
          if (
            attempt < MAX_EXTRACT_RETRIES - 1 &&
            err?.message?.includes("429") &&
            !cancelled
          ) {
            setTimeout(() => {
              if (cancelled) return;
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: `Reintentando extracción (intento ${attempt + 2}/${MAX_EXTRACT_RETRIES})…`,
                },
              ]);
              doFetch(attempt + 1);
            }, EXTRACT_RETRY_DELAY_MS);
          } else {
            setExtractedProjectLoading(false);
          }
        });
    };

    setExtractedProjectLoading(true);
    doFetch(0);

    return () => {
      cancelled = true;
      currentController?.abort();
      extractRevealRef.current?.destroy();
    };
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
            key={activeTypeId ?? "no-type"}
            messages={messages}
            onMessagesChange={setMessages}
            reportContent={reportContent}
            onReportContentChange={setReportContent}
            activeTypeId={activeTypeId}
            projectFilePaths={projectFilePaths}
            onProjectFilePathsChange={setProjectFilePaths}
            projectElementsTable={extractedProjectTable}
            projectStructuredData={extractedStructuredData ?? undefined}
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
                  {extractedProjectLoading ? (
                    "Extrayendo con IA…"
                  ) : (
                    <ProjectExtractedTable
                      rows={
                        extractedProjectTable.length > 0
                          ? extractedProjectTable.map((r) => ({
                              section: r.section ?? "—",
                              element: r.element,
                              content: r.content,
                              incomplete: r.incomplete,
                            }))
                          : parseElementoContenido(extractedProjectText?.trim() || "").map(([elem, cont]) => ({
                              section: "—",
                              element: elem,
                              content: cont,
                            }))
                      }
                      elementsWithSection={elementsWithSection}
                      extractedProjectText={extractedProjectText}
                    />
                  )}
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
            {extractedProjectLoading ? (
              "Extrayendo con IA…"
            ) : (
              <ProjectExtractedTable
                rows={
                  extractedProjectTable.length > 0
                    ? extractedProjectTable.map((r) => ({
                        section: r.section ?? "—",
                        element: r.element,
                        content: r.content,
                        incomplete: r.incomplete,
                      }))
                    : parseElementoContenido(extractedProjectText?.trim() || "").map(([elem, cont]) => ({
                        section: "—",
                        element: elem,
                        content: cont,
                      }))
                }
                elementsWithSection={elementsWithSection}
                extractedProjectText={extractedProjectText}
              />
            )}
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
