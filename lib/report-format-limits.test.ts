import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseReportFormatLimits,
  stripCharacterLimitAnnotations,
  charRange,
} from "@/lib/report-format-limits";

const SAMPLE_FORMAT = `La estructura del informe debe ser:

1. Resumen del proyecto (1000 caracteres)

2. Dimensión "Novedad" (Breve análisis general, 500 caracteres)
2.1 Subdimensión Grado de originalidad de la idea (Análisis, nota, justificación y posibles mejoras)(500 caracteres para analisis, 500 para justificacion y 500 para posibles mejoras)
2.2 Subdimensión "Estado del arte" (Análisis, nota, justificación y posibles mejoras)(500 caracteres para analisis, 500 para justificacion y 500 para posibles mejoras)

3. Dimensión Potencial de Impacto (Breve análisis general, 500 caracteres)
3.1 Subdimensión Contribución Social, Ambiental o Productivo (Análisis, nota, justificación y posibles mejoras)(500 caracteres para analisis, 500 para justificacion y 500 para posibles mejoras)

5. Síntesis de los análisis (1000 caracteres)`;

describe("parseReportFormatLimits", () => {
  it("extrae límites del formato IGIP", () => {
    const limits = parseReportFormatLimits(SAMPLE_FORMAT);
    assert.equal(limits.summary, 1000);
    assert.equal(limits.synthesis, 1000);
    assert.equal(limits.dimensions.length, 2);
    assert.equal(limits.dimensions[0].name, "Novedad");
    assert.equal(limits.dimensions[0].overview, 500);
    assert.equal(limits.dimensions[0].subdimensions.length, 2);
    assert.deepEqual(limits.dimensions[0].subdimensions[0].limits, {
      analysis: 500,
      justification: 500,
      improvements: 500,
    });
  });
});

describe("charRange", () => {
  it("calcula mínimo según ratio configurable (p. ej. pipeline charRangeMinRatio)", () => {
    const range = charRange(500, 0.9);
    assert.equal(range.max, 500);
    assert.equal(range.min, 450);
    const custom = charRange(1000, 0.85);
    assert.equal(custom.min, 850);
  });
});

describe("stripCharacterLimitAnnotations", () => {
  it("elimina anotaciones de caracteres del texto visible", () => {
    const dirty = `**Dimensión "Novedad" (~500 caracteres)**

*Análisis (~500 caracteres)*
Texto del análisis.

*Justificación (~500 caracteres)*
Texto de justificación.`;

    const clean = stripCharacterLimitAnnotations(dirty);
    assert.doesNotMatch(clean, /caracteres/i);
    assert.match(clean, /Texto del análisis/);
    assert.match(clean, /Texto de justificación/);
  });
});
