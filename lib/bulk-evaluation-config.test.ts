import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultBulkEvaluationConfig,
  mergeBulkEvaluationConfig,
} from "@/lib/bulk-evaluation-config";

describe("bulk-evaluation-config", () => {
  it("defaults incluyen índice local activo", () => {
    const d = defaultBulkEvaluationConfig();
    assert.equal(d.parallelProjects, 2);
    assert.equal(d.useClientKnowledgeIndex, true);
    assert.equal(d.preloadKnowledgeOnBulkStart, true);
  });

  it("parallelProjects se acota entre 1 y 8", () => {
    const merged = mergeBulkEvaluationConfig({ parallelProjects: 99 });
    assert.equal(merged.parallelProjects, 8);
  });
});
