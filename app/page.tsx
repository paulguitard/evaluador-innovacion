"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Header from "@/components/Header";
import ChatPanel from "@/components/ChatPanel";
import ConfigPanel from "@/components/ConfigPanel";
import BulkResultsTable from "@/components/BulkResultsTable";
import ResizableSplitPane from "@/components/ResizableSplitPane";
import type { ChatMessage } from "@/components/ChatPanel";
import { useEvaluationConfig } from "@/hooks/useEvaluationConfig";
import { useBulkEvaluation } from "@/hooks/useBulkEvaluation";
import { exportBulkResultsExcel, exportBulkResultsZip } from "@/lib/bulk-export";

type EvaluationType = { id: number; name: string };

export default function Home() {
  const [evaluationTypes, setEvaluationTypes] = useState<EvaluationType[]>([]);
  const [activeTypeId, setActiveTypeId] = useState<number | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const prevActiveTypeIdRef = useRef<number | null>(null);

  const { scoreSchema } = useEvaluationConfig(activeTypeId, configOpen);

  const {
    bulkRows,
    bulkAgents,
    bulkRunning,
    runBulkEvaluation,
    resetBulk,
    cancelBulk,
    initRowsFromFiles,
  } = useBulkEvaluation(activeTypeId, setMessages);

  const resetSessionState = useCallback(() => {
    setMessages([]);
    setBulkFiles([]);
    resetBulk();
  }, [resetBulk]);

  useEffect(() => {
    if (activeTypeId == null) return;
    if (prevActiveTypeIdRef.current != null && prevActiveTypeIdRef.current !== activeTypeId) {
      cancelBulk();
      resetSessionState();
    }
    prevActiveTypeIdRef.current = activeTypeId;
  }, [activeTypeId, cancelBulk, resetSessionState]);

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

  const activeTypeName = evaluationTypes.find((t) => t.id === activeTypeId)?.name ?? "";
  const reportTitle = activeTypeName
    ? `Informe: ${activeTypeName}`
    : "TITULO DEL INFORME DE EVALUACIÓN";

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
      />
      <ResizableSplitPane
        defaultLeftPercent={45}
        left={
          <ChatPanel
            key={activeTypeId ?? "no-type"}
            messages={messages}
            onMessagesChange={setMessages}
            activeTypeId={activeTypeId}
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
          <BulkResultsTable
            rows={bulkRows}
            schema={scoreSchema}
            evaluationTypeName={activeTypeName}
            onExportExcel={() => void handleExportExcel()}
            onExportZip={() => void handleExportZip()}
            exportingExcel={exportingExcel}
            exportingZip={exportingZip}
          />
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
    </div>
  );
}
