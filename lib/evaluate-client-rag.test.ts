import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrecomputedChunksForEvaluation } from "@/lib/evaluate-client-rag";
import type { StoredChunk } from "@/lib/chunk-types";

describe("evaluate-client-rag", () => {
  it("no precomputa subdimensiones para rúbrica por niveles", async () => {
    const chunks: StoredChunk[] = [
      {
        id: "c1",
        docName: "Manual.pdf",
        text: "Criterios de madurez tecnológica",
        embedding: [],
      },
    ];

    const out = await buildPrecomputedChunksForEvaluation({
      evaluationTypeId: 99,
      projectElementsTable: [{ element: "Nombre del proyecto", content: "DocuCore" }],
      chunks,
      plan: {
        rubricType: "niveles",
        subdimensions: [
          {
            key: "nivel-global",
            dimension: "Nivel global",
            name: "Asignación de nivel",
            rubricContent: "Nivel 1 — Idea",
          },
        ],
        ragEvaluate: { topK: 8, maxRetrievedChars: 12_000 },
        knowledgeReferenceLabel: "Knowledge",
        projectElementsInRagQuery: 6,
      },
    });

    assert.deepEqual(out, {});
  });
});
