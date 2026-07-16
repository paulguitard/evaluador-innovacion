import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findMissingFinalReportParts,
  getRawSubdimensionAnalysisIssues,
  isRawSubdimensionAnalysisComplete,
  looksLikeCompleteIgipReport,
} from "@/lib/report-completeness";
import {
  defaultReportFormatPonderaciones,
  enrichReportFormatWithLegacySections,
} from "@/lib/report-format-config";
import type { RubricConfigPonderaciones } from "@/lib/rubric-config";

const rubric: RubricConfigPonderaciones = {
  type: "ponderaciones",
  scoreScale: { min: 1, max: 4 },
  dimensions: [
    {
      id: "d1",
      name: "Novedad",
      subdimensions: [{ id: "s1", name: "Grado de Originalidad de la Idea", weightPercent: 25, scores: [] }],
    },
  ],
};

const completeSubAnalysis = `**Análisis**
El proyecto presenta una combinación de tecnologías conocidas aplicadas a un contexto nuevo con evidencia suficiente para valorar la originalidad.

Nota: 3

**Justificación**
La rúbrica asigna nota 3 cuando hay elementos novedosos distintivos. El marco teórico del Manual OSLO respalda esta lectura de new to market.

**Posibles mejoras**
1. Documentar comparativas de mercado.
2. Definir métricas de autonomía energética.`;

describe("report-completeness", () => {
  it("isRawSubdimensionAnalysisComplete acepta análisis completo", () => {
    assert.equal(isRawSubdimensionAnalysisComplete(completeSubAnalysis), true);
    assert.deepEqual(getRawSubdimensionAnalysisIssues(completeSubAnalysis), []);
  });

  it("detecta secciones faltantes y truncado", () => {
    const truncated = `**Análisis**
Texto que termina mal en ofreciendo

Nota: 2

**Justificación**
Algo breve.

**Posibles mejoras**
Una mejora.`;
    const issues = getRawSubdimensionAnalysisIssues(truncated);
    assert.ok(issues.includes("truncated"));

    const missingNota = `**Análisis**
Texto completo con punto.

**Justificación**
Texto completo.

**Posibles mejoras**
Mejora.`;
    assert.ok(getRawSubdimensionAnalysisIssues(missingNota).includes("missing_nota"));

    const withCalificacion = `**Análisis**
El proyecto presenta elementos evaluables con evidencia suficiente para valorar este criterio según la rúbrica IGIP.

**Justificación**
La rúbrica asigna nota 3 cuando hay cumplimiento parcial con elementos distintivos documentados en el proyecto.

Calificación: 3

**Posibles mejoras**
1. Ampliar documentación comparativa.
2. Definir métricas de seguimiento.`;
    const califIssues = getRawSubdimensionAnalysisIssues(withCalificacion);
    assert.ok(!califIssues.includes("missing_nota"));
  });

  it("looksLikeCompleteIgipReport distingue borrador de informe final", () => {
    const draft = `## Dimensión: Novedad

### Subdimensión: Grado de Originalidad de la Idea

${completeSubAnalysis}`;
    assert.equal(looksLikeCompleteIgipReport(draft), false);

    const finalReport = `## Resumen del proyecto

Texto del resumen del proyecto evaluado con contexto suficiente.

## Dimensión: Novedad

Resumen macro corto.

## Grado de Originalidad de la Idea

${completeSubAnalysis}

## Síntesis final

Veredicto evaluativo global del proyecto.

**Notas e índice**

Grado de Originalidad de la Idea: 3 (ponderación 25%)

**Índice IGIP**: 3.00`;
    assert.equal(looksLikeCompleteIgipReport(finalReport), true);
  });

  it("findMissingFinalReportParts exige Notas e índice en ponderaciones", () => {
    const fmt = enrichReportFormatWithLegacySections(
      defaultReportFormatPonderaciones(rubric),
      rubric,
      ""
    );
    const incomplete = `## Resumen del proyecto

Resumen.

## Dimensión: Novedad

Overview.

## Grado de Originalidad de la Idea

${completeSubAnalysis}

## Síntesis final

Síntesis.`;
    const missing = findMissingFinalReportParts(incomplete, fmt, rubric);
    assert.ok(missing.some((t) => /Notas e [íi]ndice/i.test(t)));
  });
});
