import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseRubricDimensions,
  parseRubricSubdimensions,
  summarizeProjectForEvaluationFocus,
} from "@/lib/rubric-dimensions";

const NOVEDAD_BLOCK = `Subdimensión "Grado de Originalidad de la Idea"
- Ponderación (25%)
- Nota 1: La idea presenta similitudes significativas.

Subdimensión "Estado del arte"
- Ponderación (15%)
- Nota 1: La propuesta muestra poca evidencia.`;

describe("parseRubricSubdimensions", () => {
  it("extrae dos subdimensiones con criterios", () => {
    const subs = parseRubricSubdimensions(NOVEDAD_BLOCK);
    assert.equal(subs.length, 2);
    assert.equal(subs[0].name, "Grado de Originalidad de la Idea");
    assert.match(subs[0].content, /Ponderación \(25%\)/);
    assert.equal(subs[1].name, "Estado del arte");
    assert.match(subs[1].content, /Ponderación \(15%\)/);
  });

  it("integra con parseRubricDimensions", () => {
    const rubric = `----------Dimensión Novedad:-------------
${NOVEDAD_BLOCK}
----------Dimensión Potencial de impacto:-------------
Subdimensión "Contribución Social, Ambiental o Productivo"
- Ponderación (20%)
- Nota 1: Sin impacto.`;

    const dims = parseRubricDimensions(rubric);
    assert.ok(dims.length >= 1);
    const novedad = dims.find((d) => d.name === "Novedad");
    assert.ok(novedad);
    const novedadSubs = parseRubricSubdimensions(novedad!.content);
    assert.equal(novedadSubs.length, 2);
  });
});

describe("summarizeProjectForEvaluationFocus", () => {
  const table = [
    { element: "Nombre del proyecto", content: "Proyecto solar comunal" },
    { element: "Escalabilidad", content: "Planes de replicar en otras comunas del país." },
    { element: "Factor innovador", content: "Uso de paneles bifaciales de última generación." },
  ];

  it("prioriza elementos alineados con la subdimensión evaluada", () => {
    const excerpt = summarizeProjectForEvaluationFocus(table, {
      name: "Potencial de expansión",
      dimensionName: "Escalabilidad",
      rubricContent: "Nota 1: sin planes de expansión. Nota 4: expansión nacional comprobada.",
    });
    assert.match(excerpt, /Escalabilidad/i);
    assert.match(excerpt, /replicar/i);
    assert.doesNotMatch(excerpt, /bifaciales/i);
  });
});
