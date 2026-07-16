import type { BulkChatProject } from "@/lib/bulk-chat-types";
import { formatIndicatorScore } from "@/lib/evaluation-scores";

const REPORT_SNIPPET_CHARS = 6_000;
const ELEMENTS_SNIPPET_CHARS = 8_000;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function findBulkProject(
  projects: BulkChatProject[],
  query: string
): BulkChatProject | undefined {
  const q = normalize(query.trim());
  if (!q) return undefined;
  return (
    projects.find((p) => normalize(p.id) === q) ??
    projects.find((p) => normalize(p.projectName).includes(q)) ??
    projects.find((p) => normalize(p.fileName).includes(q))
  );
}

export function listBulkProjectsSummary(projects: BulkChatProject[]): string {
  if (projects.length === 0) return "No hay proyectos evaluados en masa.";
  const lines = projects.map((p) => {
    const scoreParts = Object.entries(p.subdimensionScores)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const igip = p.overallScore != null ? ` IGIP: ${formatIndicatorScore(p.overallScore)}` : "";
    return `- ${p.projectName} (archivo: ${p.fileName})${igip}${scoreParts ? ` | ${scoreParts}` : ""}`;
  });
  return `${projects.length} proyecto(s) evaluado(s):\n${lines.join("\n")}`;
}

function trimText(text: string, max: number, label: string): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n[${label} truncado por límite de contexto.]`;
}

export function getBulkProjectDetail(
  project: BulkChatProject,
  options?: { section?: string; maxReportChars?: number }
): string {
  const parts: string[] = [
    `## ${project.projectName}`,
    `- Archivo: ${project.fileName}`,
    `- ID: ${project.id}`,
  ];
  if (project.overallScore != null) {
    parts.push(`- Indicador IGIP: ${formatIndicatorScore(project.overallScore)}`);
  }
  const scores = Object.entries(project.subdimensionScores)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `  - ${k}: ${v}`);
  if (scores.length) {
    parts.push("- Notas por subdimensión:", ...scores);
  }
  if (project.summary.trim()) {
    parts.push("", "Resumen de evaluación:", project.summary.trim());
  }
  if (project.elementsTable.length > 0) {
    const table = project.elementsTable
      .map((r) => `- **${r.element}**: ${r.content?.trim() || "—"}`)
      .join("\n");
    parts.push("", "Elementos extraídos:", trimText(table, ELEMENTS_SNIPPET_CHARS, "Tabla de extracción"));
  }
  if (project.reportContent.trim()) {
    const report = trimText(
      project.reportContent,
      options?.maxReportChars ?? REPORT_SNIPPET_CHARS,
      "Informe"
    );
    parts.push("", "Informe de evaluación:", report);
  }
  return parts.join("\n");
}

export function searchBulkProjects(projects: BulkChatProject[], query: string): string {
  const q = normalize(query.trim());
  if (!q) return "Se requiere una consulta de búsqueda.";
  const hits: string[] = [];
  for (const p of projects) {
    const snippets: string[] = [];
    for (const row of p.elementsTable) {
      const hay = `${row.element} ${row.content}`;
      if (normalize(hay).includes(q)) {
        snippets.push(`[extract] ${row.element}: ${row.content.slice(0, 400)}`);
      }
    }
    if (normalize(p.summary).includes(q)) {
      snippets.push(`[resumen] ${p.summary.slice(0, 500)}`);
    }
    if (normalize(p.reportContent).includes(q)) {
      const idx = normalize(p.reportContent).indexOf(q);
      const start = Math.max(0, idx - 200);
      snippets.push(`[informe] ${p.reportContent.slice(start, start + 600)}`);
    }
    if (snippets.length > 0) {
      hits.push(`### ${p.projectName}\n${snippets.slice(0, 5).join("\n")}`);
    }
  }
  if (hits.length === 0) return `Sin coincidencias para "${query}" en los proyectos evaluados.`;
  return `Coincidencias en ${hits.length} proyecto(s):\n\n${hits.join("\n\n")}`;
}
