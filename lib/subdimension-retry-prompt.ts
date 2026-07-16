import type { SubdimensionQualityIssue } from "@/lib/report-completeness";

/** Máximo de reintentos de calidad tras la primera pasada LLM. */
export const MAX_SUBDIM_QUALITY_RETRIES = 2;

export function buildSubdimensionRetryPrompt(
  baseUserPrompt: string,
  issues: SubdimensionQualityIssue[]
): string {
  const issueSet = new Set(issues);
  const lines = [
    baseUserPrompt,
    "",
    `IMPORTANTE: Tu respuesta anterior quedó incompleta (${issues.join(", ")}).`,
    "Reescribe la evaluación COMPLETA con todas las secciones obligatorias.",
  ];

  if (issueSet.has("missing_analisis")) {
    lines.push("- Incluye **Análisis** con evaluación sustantiva según la rúbrica.");
  }
  if (issueSet.has("missing_nota")) {
    lines.push(
      "- OBLIGATORIO: tras el Análisis, incluye una línea EXACTA «Nota: N» (N = 1, 2, 3 o 4). Ejemplo: «Nota: 3».",
      "- No uses solo prosa («una nota de tres»); la línea «Nota: N» debe aparecer literalmente."
    );
  }
  if (issueSet.has("missing_justificacion")) {
    lines.push("- Incluye **Justificación** fundamentada en el marco teórico.");
  }
  if (issueSet.has("missing_mejoras")) {
    lines.push(
      "- Incluye **Posibles mejoras** o **Sugerencias de mejora** con propuestas concretas."
    );
  }
  if (issueSet.has("truncated")) {
    lines.push(
      "- Cierra cada párrafo con punto final. No dejes oraciones a medias ni texto cortado abruptamente.",
      "- NO uses separadores markdown (`---`, `***`, `___`) entre secciones; usa solo encabezados `**Sección**`."
    );
  }

  return lines.join("\n");
}

/** Reintento corto cuando solo falta la línea de nota parseable. */
export function buildMissingNotaRecoveryPrompt(
  baseUserPrompt: string,
  priorAnalysis: string
): string {
  const excerpt = priorAnalysis.trim().slice(0, 1200);
  return `${baseUserPrompt}

CRÍTICO — solo faltó la línea de nota numérica en tu respuesta anterior.

Reescribe la evaluación COMPLETA (Análisis, Nota, Justificación, Mejoras) e incluye OBLIGATORIAMENTE una línea exacta:
Nota: N
donde N es 1, 2, 3 o 4. Colócala justo después del Análisis y antes de la Justificación.

Fragmento de tu respuesta anterior (referencia, no copies errores):
---
${excerpt}
---`;
}
