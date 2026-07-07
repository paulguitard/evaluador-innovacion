"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Header from "@/components/Header";
import ChatPanel from "@/components/ChatPanel";
import ReportPanel from "@/components/ReportPanel";
import ConfigPanel from "@/components/ConfigPanel";
import FullscreenOverlay, { ExpandIcon } from "@/components/FullscreenOverlay";
import ProjectExtractedTable from "@/components/ProjectExtractedTable";
import BulkResultsTable from "@/components/BulkResultsTable";
import ResizableSplitPane from "@/components/ResizableSplitPane";
import type { ChatMessage } from "@/components/ChatPanel";
import type { ProjectStructuredData } from "@/lib/build-context";
import type { EvaluationMode } from "@/lib/evaluation-mode";
import { useEvaluationConfig } from "@/hooks/useEvaluationConfig";
import { useProjectExtract } from "@/hooks/useProjectExtract";
import { useBulkEvaluation } from "@/hooks/useBulkEvaluation";
import { isIncompleteElement } from "@/lib/project-extract-validate";
import { exportBulkResultsExcel, exportBulkResultsZip } from "@/lib/bulk-export";

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
  const [evaluationMode, setEvaluationMode] = useState<EvaluationMode>("individual");
  const [configOpen, setConfigOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reportContent, setReportContent] = useState("");
  const [reportTitle, setReportTitle] = useState("TITULO DEL INFORME DE EVALUACIÓN");
  const [projectFilePaths, setProjectFilePaths] = useState<string[]>([]);
  const [projectFiles, setProjectFiles] = useState<File[]>([]);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [projectSectionOpen, setProjectSectionOpen] = useState(true);
  const [fullscreenSection, setFullscreenSection] = useState<"project" | "report" | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const prevActiveTypeIdRef = useRef<number | null>(null);
  const prevEvaluationModeRef = useRef<EvaluationMode>("individual");

  const { elementsWithSection, knowledgeDocNames, scoreSchema } = useEvaluationConfig(
    activeTypeId,
    configOpen
  );

  const {
    bulkRows,
    bulkAgents,
    bulkRunning,
    runBulkEvaluation,
    resetBulk,
    cancelBulk,
    initRowsFromFiles,
  } = useBulkEvaluation(activeTypeId, setMessages);

  const individualProjectFiles = useMemo(
    () => (evaluationMode === "individual" ? projectFiles : []),
    [evaluationMode, projectFiles]
  );

  const {
    extractedProjectText,
    extractedProjectTable,
    setExtractedProjectTable,
    extractedStructuredData,
    extractedProjectLoading,
    resetExtract,
  } = useProjectExtract(
    individualProjectFiles,
    activeTypeId,
    SESSION_ID,
    knowledgeDocNames,
    setMessages,
    setProjectFilePaths
  );

  const resetSessionState = useCallback(() => {
    setMessages([]);
    setReportContent("");
    setProjectFilePaths([]);
    setProjectFiles([]);
    setBulkFiles([]);
    resetExtract();
    resetBulk();
    setFullscreenSection(null);
  }, [resetExtract, resetBulk]);

  /** Al cambiar de tipo de evaluación, limpiar la UI principal. */
  useEffect(() => {
    if (activeTypeId == null) return;
    if (prevActiveTypeIdRef.current != null && prevActiveTypeIdRef.current !== activeTypeId) {
      cancelBulk();
      resetSessionState();
    }
    prevActiveTypeIdRef.current = activeTypeId;
  }, [activeTypeId, cancelBulk, resetSessionState]);

  /** Al cambiar de modo Individual/Masivo, limpiar estado. */
  useEffect(() => {
    if (prevEvaluationModeRef.current !== evaluationMode) {
      cancelBulk();
      resetSessionState();
      prevEvaluationModeRef.current = evaluationMode;
    }
  }, [evaluationMode, cancelBulk, resetSessionState]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/evaluation-types")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setEvaluationTypes(data);
          setActiveTypeId((prev) => prev ?? (data.length > 0 ? data[0].id : null));
        } else if (data?.error) {
          console.error("Error cargando tipos de evaluación:", data.error);
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("Error cargando tipos de evaluación:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [configOpen]);

  useEffect(() => {
    const t = evaluationTypes.find((x) => x.id === activeTypeId);
    setReportTitle(t ? `Informe: ${t.name}` : "TITULO DEL INFORME DE EVALUACIÓN");
  }, [activeTypeId, evaluationTypes]);

  const mergeProjectElementsFromChat = (updated: { element: string; content: string }[]) => {
    setExtractedProjectTable((prev) => {
      const byTitle = new Map(updated.map((r) => [r.element, r.content]));
      return prev.map((row) => {
        const newContent = byTitle.get(row.element);
        if (newContent === undefined) return row;
        const cfg = elementsWithSection.find((e) => e.title === row.element);
        const def = cfg
          ? { title: cfg.title, description: cfg.description, section: cfg.section }
          : { title: row.element, description: "", section: row.section ?? "General" };
        return {
          ...row,
          content: newContent,
          incomplete: isIncompleteElement(def, newContent),
        };
      });
    });
  };

  const tableRows =
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
        }));

  const activeTypeName = evaluationTypes.find((t) => t.id === activeTypeId)?.name ?? "";

  const handleBulkFilesChange = (files: File[]) => {
    setBulkFiles(files);
    initRowsFromFiles(files);
  };

  const handleBulkEvaluate = () => {
    if (bulkFiles.length === 0) return;
    void runBulkEvaluation(bulkFiles);
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      await exportBulkResultsExcel(bulkRows, scoreSchema, activeTypeName);
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportZip = async () => {
    setExportingZip(true);
    try {
      await exportBulkResultsZip(bulkRows, reportTitle.replace(/^Informe:\s*/i, "Informe"));
    } finally {
      setExportingZip(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-base">
      <Header
        types={evaluationTypes}
        activeId={activeTypeId}
        onSelect={setActiveTypeId}
        onOpenConfig={() => setConfigOpen(true)}
        evaluationMode={evaluationMode}
        onEvaluationModeChange={setEvaluationMode}
      />
      <ResizableSplitPane
        defaultLeftPercent={45}
        left={
          <ChatPanel
            key={`${activeTypeId ?? "no-type"}-${evaluationMode}`}
            messages={messages}
            onMessagesChange={setMessages}
            reportContent={reportContent}
            onReportContentChange={setReportContent}
            activeTypeId={activeTypeId}
            projectFilePaths={projectFilePaths}
            onProjectFilePathsChange={setProjectFilePaths}
            projectFiles={projectFiles}
            onProjectFilesChange={setProjectFiles}
            projectElementsTable={extractedProjectTable}
            projectStructuredData={
              !extractedProjectTable.length && extractedStructuredData
                ? (extractedStructuredData as ProjectStructuredData)
                : undefined
            }
            sessionId={SESSION_ID}
            onProjectElementsTableChange={mergeProjectElementsFromChat}
            evaluationMode={evaluationMode}
            bulkFiles={bulkFiles}
            onBulkFilesChange={handleBulkFilesChange}
            bulkRunning={bulkRunning}
            bulkAgents={bulkAgents}
            bulkRows={bulkRows}
            bulkScoreSchema={scoreSchema}
            onBulkEvaluate={handleBulkEvaluate}
          />
        }
        right={
          evaluationMode === "bulk" ? (
            <BulkResultsTable
              rows={bulkRows}
              schema={scoreSchema}
              evaluationTypeName={activeTypeName}
              onExportExcel={() => void handleExportExcel()}
              onExportZip={() => void handleExportZip()}
              exportingExcel={exportingExcel}
              exportingZip={exportingZip}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div
                className={`flex flex-col border-b border-border ${projectSectionOpen ? "min-h-0 flex-1" : "shrink-0"}`}
              >
                <div className="flex shrink-0 w-full items-center gap-2 border-b border-border px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setProjectSectionOpen((o) => !o)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-lg font-semibold text-foreground hover:bg-surface-elevated focus:outline-none focus:ring-1 focus:ring-focus-ring"
                  >
                    <span className="text-foreground-muted" aria-hidden>
                      {projectSectionOpen ? "▼" : "▶"}
                    </span>
                    Proyecto extraído
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullscreenSection("project")}
                    className="shrink-0 rounded p-2 text-foreground-muted hover:bg-surface-elevated hover:text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
                    title="Pantalla completa"
                    aria-label="Ver en pantalla completa"
                  >
                    <ExpandIcon />
                  </button>
                </div>
                {projectSectionOpen && (
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-foreground">
                    {extractedProjectLoading ? (
                      "Extrayendo con IA…"
                    ) : (
                      <ProjectExtractedTable
                        rows={tableRows}
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
          )
        }
      />
      <ConfigPanel
        isOpen={configOpen}
        onClose={() => setConfigOpen(false)}
        types={evaluationTypes}
        activeId={activeTypeId}
        onTypesChange={() => fetch("/api/evaluation-types").then((r) => r.json()).then(setEvaluationTypes)}
        onSelectType={setActiveTypeId}
      />
      {fullscreenSection === "project" && evaluationMode === "individual" && (
        <FullscreenOverlay title="Proyecto extraído" onClose={() => setFullscreenSection(null)}>
          <div className="text-sm text-foreground">
            {extractedProjectLoading ? (
              "Extrayendo con IA…"
            ) : (
              <ProjectExtractedTable
                rows={tableRows}
                elementsWithSection={elementsWithSection}
                extractedProjectText={extractedProjectText}
              />
            )}
          </div>
        </FullscreenOverlay>
      )}
      {fullscreenSection === "report" && evaluationMode === "individual" && (
        <FullscreenOverlay title={reportTitle} onClose={() => setFullscreenSection(null)}>
          <div className="text-foreground" style={{ whiteSpace: "pre-wrap" }}>
            {reportContent || "Cuerpo del informe de evaluación. Ejecute \"Evaluar\" para generar el informe."}
          </div>
        </FullscreenOverlay>
      )}
    </div>
  );
}
