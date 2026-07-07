import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cosineSimilarity,
  keywordScore,
  scoreChunks,
} from "@/lib/hybrid-search-core";

describe("hybrid-search-core", () => {
  it("cosineSimilarity de vectores idénticos es 1", () => {
    const v = [1, 0, 0];
    assert.equal(cosineSimilarity(v, v), 1);
  });

  it("keywordScore aumenta con términos compartidos", () => {
    const low = keywordScore("innovación producto", "texto sobre economía");
    const high = keywordScore("innovación producto", "la innovación del producto");
    assert.ok(high > low);
  });

  it("scoreChunks devuelve chunks ordenados por score", () => {
    const chunks = [
      {
        id: "a",
        docName: "d",
        text: "innovación novedad originalidad",
        embedding: [1, 0],
      },
      {
        id: "b",
        docName: "d",
        text: "otro tema",
        embedding: [0, 1],
      },
    ];
    const ranked = scoreChunks(chunks, "innovación novedad", [1, 0], { topK: 2 });
    assert.equal(ranked[0]?.id, "a");
    assert.ok(ranked[0]!.score >= (ranked[1]?.score ?? 0));
  });
});
