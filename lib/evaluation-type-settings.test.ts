import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultEvaluationTypeSettings,
  mergeEvaluationTypeSettings,
} from "@/lib/evaluation-type-settings";

describe("mergeEvaluationTypeSettings", () => {
  it("aplica defaults IGIP cuando no hay JSONB", () => {
    const merged = mergeEvaluationTypeSettings(null, "IGIP");
    const defaults = defaultEvaluationTypeSettings("IGIP");
    assert.equal(merged.pipeline.indicatorLabel, "IGIP");
    assert.equal(merged.pipeline.charRangeMinRatio, defaults.pipeline.charRangeMinRatio);
    assert.equal(merged.rag.chunkSizeChars, defaults.rag.chunkSizeChars);
    assert.equal(merged.extract.elementTimeoutMs, defaults.extract.elementTimeoutMs);
  });

  it("respeta overrides parciales de pipeline", () => {
    const merged = mergeEvaluationTypeSettings(
      {
        pipeline_config: { indicatorLabel: "TRL", charRangeMinRatio: 0.85 },
      },
      "TRL"
    );
    assert.equal(merged.pipeline.indicatorLabel, "TRL");
    assert.equal(merged.pipeline.charRangeMinRatio, 0.85);
  });

  it("usa nombre del tipo como etiqueta por defecto", () => {
    const merged = mergeEvaluationTypeSettings({}, "IMET");
    assert.equal(merged.pipeline.indicatorLabel, "IMET");
  });

  it("hace clamp de rag chunk size", () => {
    const merged = mergeEvaluationTypeSettings({
      rag_config: { chunkSizeChars: 50, overlapChars: 9999 },
    });
    assert.ok(merged.rag.chunkSizeChars >= 200);
    assert.ok(merged.rag.overlapChars <= merged.rag.chunkSizeChars);
  });
});
