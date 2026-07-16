import type { BulkProjectRow } from "@/hooks/useBulkEvaluation";
import { formatIndicatorScore, type RubricScoreSchemaEntry } from "@/lib/evaluation-scores";

const REPORT_EXCERPT_CHARS = 4_500;
const SUMMARY_CHARS = 1_500;
const ELEMENTS_TABLE_CHARS = 3_000;

export type BuildBulkEvaluationChatContextOptions = {
  /** Mensaje del usuario; permite priorizar extractos del informe por subdimensión mencionada. */
  userMessage?: string;
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimToLimit(text: string, maxChars: number, label: string): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n\n[${label} truncado por límite de contexto.]`;
}

function formatElementsTable(
  table: { element: string; content: string }[],
  maxChars: number
): string {
  const lines = table
    .map((r) => {
      const content = r.content?.trim();
      if (!content || content === "—") return null;
      return `- **${r.element}**: ${content}`;
    })
    .filter((line): line is string => line != null);
  if (lines.length === 0) return "";
  return trimToLimit(lines.join("\n"), maxChars, "Tabla de extracción");
}

function findMentionedSubdimension(
  userMessage: string | undefined,
  schema: RubricScoreSchemaEntry[]
): RubricScoreSchemaEntry | undefined {
  if (!userMessage?.trim()) return undefined;
  const m = userMessage.toLowerCase();
  return schema.find(
    (s) =>
      m.includes(s.name.toLowerCase()) ||
      m.includes(s.key.toLowerCase().replace(/_/g, " "))
  );
}

function extractReportExcerpt(
  report: string,
  options?: { userMessage?: string; schema?: RubricScoreSchemaEntry[] }
): string {
  const t = report.trim();
  if (!t) return "";

  const subdim = findMentionedSubdimension(options?.userMessage, options?.schema ?? []);
  if (subdim) {
    const name = escapeRegex(subdim.name);
    const patterns = [
      new RegExp(
        `###\\s*Subdimensi[oó]n[:\\s]*${name}[\\s\\S]{0,${REPORT_EXCERPT_CHARS}}`,
        "i"
      ),
      new RegExp(
        `(?:^|\\n)#{1,3}\\s*[^\\n]*${name}[\\s\\S]{0,${REPORT_EXCERPT_CHARS}}`,
        "i"
      ),
      new RegExp(`${name}[\\s\\S]{0,${REPORT_EXCERPT_CHARS}}`, "i"),
    ];
    for (const pattern of patterns) {
      const match = t.match(pattern);
      if (match && match[0].trim().length > 120) {
        return trimToLimit(match[0], REPORT_EXCERPT_CHARS, "Extracto del informe");
      }
    }
  }

  return trimToLimit(t, REPORT_EXCERPT_CHARS, "Informe");
}

/** Contexto de evaluación masiva para el chat (extracts, informes, notas, comparaciones). */
export function buildBulkEvaluationChatContext(
  rows: BulkProjectRow[],
  schema: RubricScoreSchemaEntry[],
  options?: BuildBulkEvaluationChatContextOptions
): string {
  const evaluated = rows.filter((r) => r.evaluationStatus === "done");
  if (evaluated.length === 0) return "";

  const parts: string[] = [
    "## Resultados de evaluación masiva (contexto para preguntas del usuario)",
    "",
    "REGLA: Cuando el usuario pregunte por proyectos evaluados, compara o analiza usando principalmente la información de esta sección (extracts, notas, resúmenes e informes). Puedes complementar con la rúbrica o el Knowledge si el planificador los incluye en el contexto.",
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
    if (row.summary.trim()) {
      parts.push("", "Resumen de evaluación:", trimToLimit(row.summary, SUMMARY_CHARS, "Resumen"));
    }
    if (row.elementsTable.length > 0) {
      const tableText = formatElementsTable(row.elementsTable, ELEMENTS_TABLE_CHARS);
      if (tableText) {
        parts.push("", "Elementos extraídos del proyecto:", tableText);
      }
    }
    if (row.reportContent.trim()) {
      parts.push(
        "",
        "Extracto del informe de evaluación:",
        extractReportExcerpt(row.reportContent, {
          userMessage: options?.userMessage,
          schema,
        })
      );
    }
    parts.push("");
  }

  return parts.join("\n").trim();
}
