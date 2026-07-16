/** Proyecto evaluado en masa, serializado para el chat y las tools del agente. */
export type BulkChatProject = {
  id: string;
  projectName: string;
  fileName: string;
  elementsTable: { element: string; content: string }[];
  subdimensionScores: Record<string, number | null>;
  overallScore: number | null;
  summary: string;
  reportContent: string;
};

export function buildBulkChatProjects(
  rows: Array<{
    id: string;
    projectName: string;
    fileName: string;
    evaluationStatus: string;
    elementsTable: { element: string; content: string }[];
    subdimensionScores: Record<string, number | null>;
    overallScore: number | null;
    summary: string;
    reportContent: string;
  }>
): BulkChatProject[] {
  return rows
    .filter((r) => r.evaluationStatus === "done")
    .map((r) => ({
      id: r.id,
      projectName: r.projectName,
      fileName: r.fileName,
      elementsTable: r.elementsTable,
      subdimensionScores: r.subdimensionScores,
      overallScore: r.overallScore,
      summary: r.summary,
      reportContent: r.reportContent,
    }));
}
