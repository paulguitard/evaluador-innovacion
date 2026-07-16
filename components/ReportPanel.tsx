"use client";

import { useState, useRef, useEffect } from "react";
import { generateEvaluationPdfBlob } from "@/lib/evaluation-pdf";

const ExpandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

export default function ReportPanel({
  title,
  body,
  exportEnabled = true,
  statusHint,
  onFullscreenRequest,
}: {
  title: string;
  body: string;
  /** Solo true cuando el informe final está completo (no borrador). */
  exportEnabled?: boolean;
  statusHint?: string;
  onFullscreenRequest?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [body]);

  const handleExportPdf = async () => {
    if (!exportEnabled) return;
    const blob = await generateEvaluationPdfBlob(
      title || "Informe de evaluación",
      body || "El informe aparecerá aquí al ejecutar la evaluación."
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "informe-evaluacion.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface-base">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          <span className="shrink-0 text-foreground-muted" aria-hidden>
            {expanded ? "▼" : "▶"}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-foreground">
              {title || "TITULO DEL INFORME DE EVALUACIÓN"}
            </h2>
            {statusHint ? (
              <p className="truncate text-xs text-foreground-muted">{statusHint}</p>
            ) : null}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {onFullscreenRequest && (
            <button
              type="button"
              onClick={onFullscreenRequest}
              className="rounded p-2 text-foreground-muted hover:bg-surface-elevated hover:text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
              title="Pantalla completa"
              aria-label="Ver informe en pantalla completa"
            >
              <ExpandIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={!exportEnabled || !body.trim()}
            title={
              exportEnabled
                ? "Exportar PDF"
                : "El informe aún no está completo (borrador o formateo en curso)"
            }
            className="rounded px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            Exportar PDF
          </button>
        </div>
      </div>
      {expanded && (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-foreground"
          style={{ whiteSpace: "pre-wrap" }}
        >
          {body || "Cuerpo del informe de evaluación. Ejecute \"Evaluar\" para generar el informe."}
        </div>
      )}
    </div>
  );
}
