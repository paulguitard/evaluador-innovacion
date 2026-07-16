import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BulkProjectRow } from "@/hooks/useBulkEvaluation";
import { buildBulkEvaluationChatContext } from "@/lib/bulk-chat-context";
import { buildRubricScoreSchema } from "@/lib/evaluation-scores";

const SAMPLE_RUBRIC = `----------Dimensión Potencial de impacto:-------------
Subdimensión "Transferencia Tecnológica"
- Ponderación (15%)
- Nota 1: Sin transferencia.
- Nota 2: Transferencia limitada.
- Nota 3: Transferencia clara con evidencia.`;

const schema = buildRubricScoreSchema(SAMPLE_RUBRIC);
const transferenciaKey =
  schema.find((s) => s.name.includes("Transferencia"))?.key ?? "transferencia_tecnologica";

function makeRow(overrides: Partial<BulkProjectRow> = {}): BulkProjectRow {
  return {
    id: "bulk-0-test.xlsx",
    fileName: "test.xlsx",
    projectName: "CONenergía",
    file: new File([], "test.xlsx"),
    extractionStatus: "done",
    evaluationStatus: "done",
    elementsTable: [
      { element: "Nombre del proyecto", content: "CONenergía" },
      { element: "Objetivo general", content: "Generar conciencia energética." },
    ],
    subdimensionScores: { [transferenciaKey]: 2 },
    overallScore: 2.5,
    summary: "Proyecto de consultoría con impacto social pero transferencia limitada.",
    reportContent: [
      "Informe IGIP",
      "",
      "### Subdimensión: Transferencia Tecnológica",
      "Nota: 2",
      "La consultoría no incorpora herramientas tecnológicas propias.",
      "Posibles mejoras: prototipo digital de seguimiento.",
    ].join("\n"),
    ...overrides,
  };
}

describe("buildBulkEvaluationChatContext", () => {
  it("incluye summary, extracts y notas", () => {
    const text = buildBulkEvaluationChatContext([makeRow()], schema);
    assert.match(text, /Resumen de evaluación:/);
    assert.match(text, /Elementos extraídos del proyecto:/);
    assert.match(text, /Objetivo general/);
    assert.match(text, /Transferencia Tecnológica: 2/);
    assert.match(text, /principalmente la información de esta sección/);
    assert.doesNotMatch(text, /ÚNICAMENTE la información de esta sección/);
  });

  it("prioriza extracto del informe por subdimensión mencionada", () => {
    const text = buildBulkEvaluationChatContext([makeRow()], schema, {
      userMessage: "¿Cómo subir Transferencia Tecnológica de 2 a 3?",
    });
    assert.match(text, /prototipo digital de seguimiento/);
    assert.match(text, /Transferencia Tecnológica/);
  });
});
