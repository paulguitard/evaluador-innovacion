import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMissingNotaRecoveryPrompt,
  buildSubdimensionRetryPrompt,
  MAX_SUBDIM_QUALITY_RETRIES,
} from "@/lib/subdimension-retry-prompt";

describe("subdimension-retry-prompt", () => {
  it("MAX_SUBDIM_QUALITY_RETRIES es 2", () => {
    assert.equal(MAX_SUBDIM_QUALITY_RETRIES, 2);
  });

  it("buildSubdimensionRetryPrompt incluye instrucciones según issues", () => {
    const prompt = buildSubdimensionRetryPrompt("BASE", ["missing_nota", "truncated"]);
    assert.ok(prompt.includes("BASE"));
    assert.ok(prompt.includes("missing_nota"));
    assert.ok(prompt.includes("Nota: N"));
    assert.ok(prompt.includes("truncated") || prompt.includes("oraciones a medias"));
  });

  it("buildMissingNotaRecoveryPrompt exige línea Nota literal", () => {
    const p = buildMissingNotaRecoveryPrompt("BASE", "análisis previo");
    assert.ok(p.includes("Nota: N"));
    assert.ok(p.includes("análisis previo"));
  });
});
