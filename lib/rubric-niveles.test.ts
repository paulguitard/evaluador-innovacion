import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMajorityLevel,
  extractGlobalLevelSection,
  extractVariableSection,
  parseAssignedLevel,
  syncVariableLevelsWithMain,
} from "@/lib/rubric-niveles";

describe("rubric-niveles", () => {
  it("computeMajorityLevel elige mayoría", () => {
    assert.equal(computeMajorityLevel([4, 4, 3]), 4);
    assert.equal(computeMajorityLevel([3, 4, 4]), 4);
  });

  it("computeMajorityLevel en empate gana el nivel más alto", () => {
    assert.equal(computeMajorityLevel([3, 4]), 4);
    assert.equal(computeMajorityLevel([2, 3, 4]), 4);
  });

  it("parseAssignedLevel valida contra escala", () => {
    assert.equal(parseAssignedLevel("Nivel: 3\nok", [0, 1, 2, 3, 4]), 3);
    assert.equal(parseAssignedLevel("Nivel: 9", [0, 1, 2, 3, 4]), null);
  });

  it("syncVariableLevelsWithMain alinea por índice aunque haya números duplicados", () => {
    const main = [
      { id: "a", level: 2, title: "A", description: "d0" },
      { id: "b", level: 2, title: "B", description: "d1" },
    ];
    const synced = syncVariableLevelsWithMain(main, [
      { level: 0, title: "Var0", description: "v0" },
      { level: 1, title: "Var1", description: "v1" },
    ]);
    assert.equal(synced.length, 2);
    assert.equal(synced[0].title, "Var0");
    assert.equal(synced[1].title, "Var1");
    assert.equal(synced[0].level, 2);
    assert.equal(synced[1].level, 2);
  });

  it("syncVariableLevelsWithMain alinea niveles", () => {
    const main = [
      { id: "a", level: 0, title: "Exploración", description: "d0" },
      { id: "b", level: 1, title: "Oportunidad", description: "d1" },
    ];
    const synced = syncVariableLevelsWithMain(main, [
      { level: 0, title: "Var0", description: "v0" },
    ]);
    assert.equal(synced.length, 2);
    assert.equal(synced[0].title, "Var0");
    assert.equal(synced[1].title, "Oportunidad");
  });

  it("extractVariableSection y global", () => {
    const raw = `### Variable: Tecnología

Análisis largo
Nivel: 4

### Variable: Mercado

Nivel: 3

---

## Nivel asignado global

Nivel: 4
Justificación breve`;

    assert.ok(extractVariableSection(raw, "Tecnología")?.includes("Nivel: 4"));
    assert.ok(extractGlobalLevelSection(raw)?.includes("Nivel: 4"));
  });
});
