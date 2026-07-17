import { fileBaseName } from "@/lib/evaluation-mode";
import type { RubricScoreSchemaEntry } from "@/lib/evaluation-scores";
import { parseResponseJson } from "@/lib/fetch-json";

export type SaveEvaluationHistoryPayload = {
  evaluationTypeId: number;
  evaluationTypeName: string;
  projectName: string;
  fileName: string;
  reportContent: string;
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
  summary: string;
  scoreSchema: RubricScoreSchemaEntry[];
};

/** Nombre del proyecto desde la tabla de elementos, o el nombre de archivo como fallback. */
export function extractProjectNameFromElements(
  elementsTable: { element: string; content: string }[],
  fileName: string
): string {
  const row = elementsTable.find(
    (r) => r.element.toLowerCase().trim() === "nombre del proyecto"
  );
  const content = row?.content?.trim();
  if (content && content !== "—" && content.length > 0) return content;
  return fileBaseName(fileName);
}

export async function saveEvaluationToHistory(
  payload: SaveEvaluationHistoryPayload
): Promise<void> {
  const res = await fetch("/api/evaluation-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await parseResponseJson<{ error?: string } | null>(res).catch(
      () => null
    );
    throw new Error(data?.error || `Error al guardar historial (${res.status})`);
  }
}
