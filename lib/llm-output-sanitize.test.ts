import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseRunawayRepetition,
  sanitizeLlmEvaluationText,
} from "./llm-output-sanitize";

describe("collapseRunawayRepetition", () => {
  it("deja texto normal intacto", () => {
    const text =
      "El proyecto propone un sistema piloto de hidrógeno verde para alumbrado público.";
    assert.equal(collapseRunawayRepetition(text), text);
  });

  it("colapsa bucles de frase corta tipo informe degenerado", () => {
    const loop = Array.from({ length: 40 }, () => "propician mandatos").join(" ");
    const text = `Además, el proyecto se alinea con la rúbrica. ${loop} Fin.`;
    const out = collapseRunawayRepetition(text);
    assert.ok(out.includes("Además, el proyecto"));
    assert.ok(out.includes("Fin."));
    assert.ok(out.length < text.length / 5);
    const count = (out.match(/propician mandatos/g) || []).length;
    assert.ok(count <= 3, `quedaron ${count} repeticiones`);
  });

  it("colapsa 'mandatos obligatorios propician' repetido", () => {
    const unit = "mandatos obligatorios propician";
    const loop = Array.from({ length: 25 }, () => unit).join(" ");
    const out = collapseRunawayRepetition(`Inicio ${loop} cierre`);
    assert.ok(out.startsWith("Inicio"));
    assert.ok(out.endsWith("cierre"));
    assert.ok((out.match(/mandatos obligatorios propician/g) || []).length <= 3);
  });
});

describe("sanitizeLlmEvaluationText", () => {
  it("recorta y colapsa", () => {
    const loop = Array.from({ length: 30 }, () => "propician mandatos").join(" ");
    const out = sanitizeLlmEvaluationText(`  ${loop}  `);
    assert.ok(out.length < 80);
  });
});
