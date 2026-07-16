import type { BulkProjectRow } from "@/hooks/useBulkEvaluation";
import { formatIndicatorScore, type RubricScoreSchemaEntry } from "@/lib/evaluation-scores";
import { generateEvaluationPdfBlob, sanitizeFileName } from "@/lib/evaluation-pdf";
import { looksLikeCompleteIgipReport } from "@/lib/report-completeness";

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportBulkResultsExcel(
  rows: BulkProjectRow[],
  schema: RubricScoreSchemaEntry[],
  evaluationTypeName: string
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const mod =
    (ExcelJS as { default?: { Workbook?: unknown }; Workbook?: unknown }).default ?? ExcelJS;
  const WorkbookCtor = (mod as { Workbook: new () => import("exceljs").Workbook }).Workbook;
  const workbook = new WorkbookCtor();
  const sheet = workbook.addWorksheet("Evaluación masiva");

  const headers = [
    "Nombre proyecto",
    "Archivo",
    "Estado extracción",
    "Estado evaluación",
    ...schema.map((s) => `${s.dimension} / ${s.name}`),
    "Nota indicador general",
  ];
  sheet.addRow(headers);

  for (const row of rows) {
    sheet.addRow([
      row.projectName,
      row.fileName,
      row.extractionStatus,
      row.evaluationStatus,
      ...schema.map((s) => row.subdimensionScores[s.key] ?? ""),
      row.overallScore != null ? formatIndicatorScore(row.overallScore) : "",
    ]);
  }

  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => {
    col.width = 18;
  });

  const date = new Date().toISOString().slice(0, 10);
  const safeName = sanitizeFileName(evaluationTypeName || "evaluacion");
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, `evaluacion-masiva-${safeName}-${date}.xlsx`);
}

export async function exportBulkResultsZip(
  rows: BulkProjectRow[],
  reportTitlePrefix: string
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const withReports = rows.filter(
    (r) => r.reportContent.trim().length > 0 && looksLikeCompleteIgipReport(r.reportContent)
  );
  if (withReports.length === 0) {
    throw new Error(
      "No hay informes completos para exportar. Espere a que termine el formateo o reintente las filas con error."
    );
  }

  for (const row of withReports) {
    const title = `${reportTitlePrefix}: ${row.projectName}`;
    const blob = await generateEvaluationPdfBlob(title, row.reportContent);
    const arrayBuffer = await blob.arrayBuffer();
    const fileName = `${sanitizeFileName(row.projectName)}.pdf`;
    zip.file(fileName, arrayBuffer);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, "informes-evaluacion.zip");
}
