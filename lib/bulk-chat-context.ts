import type { BulkProjectRow } from "@/hooks/useBulkEvaluation";
import { formatIndicatorScore, type RubricScoreSchemaEntry } from "@/lib/evaluation-scores";

const REPORT_EXCERPT_CHARS = 4_500;

function trimReportExcerpt(report: string): string {
  const t = report.trim();
  if (t.length <= REPORT_EXCERPT_CHARS) return t;
  return `${t.slice(0, REPORT_EXCERPT_CHARS)}\n\n[Informe truncado por límite de contexto.]`;
}

/** Contexto de evaluación masiva para el chat (informes, notas, comparaciones). */
export function buildBulkEvaluationChatContext(
  rows: BulkProjectRow[],
  schema: RubricScoreSchemaEntry[]
): string {
  const evaluated = rows.filter((r) => r.evaluationStatus === "done");
  if (evaluated.length === 0) return "";

  const parts: string[] = [
    "## Resultados de evaluación masiva (contexto para preguntas del usuario)",
    "",
    "REGLA: Cuando el usuario pregunte por proyectos evaluados, compara o analiza usando ÚNICAMENTE la información de esta sección.",
    "",
  ];

  for (const row of evaluated) {
    parts.push(`### ${row.projectName}`);
    parts.push(`- Archivo: ${row.fileName}`);
    if (row.overallScore != null) {
      parts.push(`- Indicador IGIP: ${formatIndicatorScore(row.overallScore)}`);
    }
    const scoreLines = schema
      .map((s) => {
        const n = row.subdimensionScores[s.key];
        return n != null ? `  - ${s.name}: ${n}` : null;
      })
      .filter((line): line is string => line != null);
    if (scoreLines.length) {
      parts.push("- Notas por subdimensión:");
      parts.push(...scoreLines);
    }
    if (row.reportContent.trim()) {
      parts.push("", "Extracto del informe de evaluación:", trimReportExcerpt(row.reportContent));
    }
    parts.push("");
  }

  return parts.join("\n").trim();
}
