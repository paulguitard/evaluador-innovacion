"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIndicatorScore, type RubricScoreSchemaEntry } from "@/lib/evaluation-scores";
import type { BulkProjectRow, BulkProjectStatus } from "@/hooks/useBulkEvaluation";

const CELL_BORDER = "border border-border";

function StatusBadge({ status }: { status: BulkProjectStatus }) {
  const styles: Record<BulkProjectStatus, string> = {
    pending: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    done: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  const labels: Record<BulkProjectStatus, string> = {
    pending: "Pendiente",
    running: "En curso",
    done: "Completado",
    error: "Error",
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

type ColKey = string;

function buildDefaultWidths(schema: RubricScoreSchemaEntry[]): Record<ColKey, number> {
  const widths: Record<ColKey, number> = {
    project: 200,
    extraction: 115,
    evaluation: 115,
    indicator: 95,
  };
  for (const col of schema) {
    widths[col.key] = Math.max(130, Math.min(220, col.name.length * 7 + 24));
  }
  return widths;
}

export default function BulkResultsTable({
  rows,
  schema,
  evaluationTypeName,
  onExportExcel,
  onExportZip,
  exportingExcel,
  exportingZip,
}: {
  rows: BulkProjectRow[];
  schema: RubricScoreSchemaEntry[];
  evaluationTypeName: string;
  onExportExcel: () => void;
  onExportZip: () => void;
  exportingExcel?: boolean;
  exportingZip?: boolean;
}) {
  const defaultWidths = useMemo(() => buildDefaultWidths(schema), [schema]);
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(defaultWidths);
  const [resizing, setResizing] = useState<{
    kind: "col";
    key: string;
    startPos: number;
    startSize: number;
  } | null>(null);

  useEffect(() => {
    setColWidths((prev) => ({ ...defaultWidths, ...prev }));
  }, [defaultWidths]);

  const onResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!resizing) return;
      const delta = e.clientX - resizing.startPos;
      setColWidths((prev) => ({
        ...prev,
        [resizing.key]: Math.max(72, resizing.startSize + delta),
      }));
    },
    [resizing]
  );

  const onResizeEnd = useCallback(() => {
    setResizing(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!resizing) return;
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
    return () => {
      window.removeEventListener("mousemove", onResizeMove);
      window.removeEventListener("mouseup", onResizeEnd);
    };
  }, [resizing, onResizeMove, onResizeEnd]);

  const startColResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizing({
      kind: "col",
      key,
      startPos: e.clientX,
      startSize: colWidths[key] ?? 120,
    });
  };

  const hasCompletedEval = rows.some((r) => r.evaluationStatus === "done");
  const hasReports = rows.some((r) => r.reportContent.trim().length > 0);

  const renderResizeHandle = (colKey: string) => (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(e) => startColResize(colKey, e)}
      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-blue-400/60"
    />
  );

  return (
    <div className="flex h-full flex-col bg-surface-base">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">
          Evaluación masiva{evaluationTypeName ? `: ${evaluationTypeName}` : ""}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onExportExcel}
            disabled={!hasCompletedEval || exportingExcel}
            className="rounded px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
          >
            {exportingExcel ? "Generando…" : "Descargar Excel"}
          </button>
          <button
            type="button"
            onClick={onExportZip}
            disabled={!hasReports || exportingZip}
            className="rounded px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
          >
            {exportingZip ? "Generando…" : "Descargar ZIP (PDFs)"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">
            Elija una carpeta con archivos de proyecto (Excel, PDF o Word) y pulse Evaluar.
          </p>
        ) : (
          <table
            className="border-collapse text-sm"
            style={{ tableLayout: "fixed", minWidth: "100%" }}
          >
            <thead className="sticky top-0 z-20 bg-surface-raised">
              <tr>
                <th
                  className={`relative ${CELL_BORDER} bg-surface-raised px-2 py-2 text-left align-bottom text-xs font-semibold leading-snug text-foreground`}
                  style={{ width: colWidths.project, minWidth: colWidths.project }}
                >
                  Nombre proyecto
                  {renderResizeHandle("project")}
                </th>
                <th
                  className={`relative ${CELL_BORDER} px-2 py-2 text-left align-bottom text-xs font-semibold text-foreground`}
                  style={{ width: colWidths.extraction }}
                >
                  Extracción
                  {renderResizeHandle("extraction")}
                </th>
                <th
                  className={`relative ${CELL_BORDER} px-2 py-2 text-left align-bottom text-xs font-semibold text-foreground`}
                  style={{ width: colWidths.evaluation }}
                >
                  Evaluación
                  {renderResizeHandle("evaluation")}
                </th>
                {schema.map((col) => (
                  <th
                    key={col.key}
                    className={`relative ${CELL_BORDER} px-2 py-2 text-center align-bottom text-xs font-semibold leading-snug text-foreground`}
                    style={{ width: colWidths[col.key] ?? 140 }}
                    title={`${col.dimension}${col.weight != null ? ` (${col.weight}%)` : ""}`}
                  >
                    <span className="block whitespace-normal break-words">{col.name}</span>
                    {renderResizeHandle(col.key)}
                  </th>
                ))}
                <th
                  className={`relative ${CELL_BORDER} px-2 py-2 text-center align-bottom text-xs font-semibold text-foreground`}
                  style={{ width: colWidths.indicator }}
                >
                  Indicador IGIP
                  {renderResizeHandle("indicator")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                  <tr key={row.id}>
                    <td
                      className={`${CELL_BORDER} relative bg-surface-base px-2 py-2 align-top text-xs font-medium text-foreground`}
                      title={row.errorMessage || row.projectName}
                    >
                      <div className="h-full overflow-auto whitespace-normal break-words">
                        {row.projectName}
                      </div>
                    </td>
                    <td className={`${CELL_BORDER} px-2 py-2 align-top`}>
                      <StatusBadge status={row.extractionStatus} />
                    </td>
                    <td className={`${CELL_BORDER} px-2 py-2 align-top`}>
                      <StatusBadge status={row.evaluationStatus} />
                    </td>
                    {schema.map((col) => {
                      const score = row.subdimensionScores[col.key];
                      return (
                        <td
                          key={col.key}
                          className={`${CELL_BORDER} px-2 py-2 text-center align-top text-foreground`}
                        >
                          {score != null ? score : row.evaluationStatus === "done" ? "—" : ""}
                        </td>
                      );
                    })}
                    <td
                      className={`${CELL_BORDER} px-2 py-2 text-center align-top font-semibold text-foreground`}
                    >
                      {row.overallScore != null ? formatIndicatorScore(row.overallScore) : ""}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
