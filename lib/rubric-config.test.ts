import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRubricScoreSchemaFromConfig,
  defaultRubricConfigPonderaciones,
  isRubricConfigValid,
  mergeRubricConfig,
  parseRubricFromLegacyText,
  totalWeightPercent,
} from "@/lib/rubric-config";

const LEGACY_TEXT = `----------Dimensión Novedad:-------------
Subdimensión "Grado de Originalidad de la Idea"
- Ponderación (25%)
- Nota 1: Bajo
- Nota 2: Medio
- Nota 3: Alto
- Nota 4: Muy alto

Subdimensión "Estado del arte"
- Ponderación (75%)
- Nota 1: Bajo`;

describe("rubric-config", () => {
  it("default IGIP tiene pesos y escala 1-4", () => {
    const cfg = defaultRubricConfigPonderaciones();
    assert.equal(cfg.type, "ponderaciones");
    assert.equal(cfg.scoreScale.min, 1);
    assert.equal(cfg.scoreScale.max, 4);
    assert.ok(cfg.dimensions.length >= 1);
  });

  it("merge respeta tipo niveles para TRL", () => {
    const cfg = mergeRubricConfig({}, "TRL");
    assert.equal(cfg.type, "niveles");
    assert.ok(cfg.type === "niveles" && cfg.levels.length >= 9);
  });

  it("parse legacy text produce ponderaciones", () => {
    const parsed = parseRubricFromLegacyText(LEGACY_TEXT);
    assert.ok(parsed);
    assert.equal(parsed!.dimensions[0].name, "Novedad");
    assert.equal(parsed!.dimensions[0].subdimensions[0].weightPercent, 25);
  });

  it("buildRubricScoreSchemaFromConfig genera entradas", () => {
    const cfg = parseRubricFromLegacyText(LEGACY_TEXT)!;
    const schema = buildRubricScoreSchemaFromConfig(cfg);
    assert.equal(schema.length, 2);
    assert.equal(schema[0].weight, 25);
  });

  it("validación exige peso 100%", () => {
    const cfg = defaultRubricConfigPonderaciones();
    assert.equal(isRubricConfigValid(cfg), true);
    const bad = { ...cfg, dimensions: [{ ...cfg.dimensions[0], subdimensions: [] }] };
    assert.equal(isRubricConfigValid(bad), false);
    assert.equal(totalWeightPercent(cfg), 100);
  });
});
