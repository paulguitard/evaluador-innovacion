import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { ragStatusFromMeta } from "@/lib/rag-status-utils";
import {
  clearAsyncChunkCache,
  getCachedChunksAsync,
  invalidateAsyncChunkCache,
} from "@/lib/chunk-cache-async";
import type { StoredChunk } from "@/lib/vector-store";

describe("rag-status", () => {
  it("ragStatusFromMeta usa chunkCount y chunksFileBytes del meta", () => {
    const stats = ragStatusFromMeta({
      indexedAt: "2024-07-03T12:00:00.000Z",
      knowledgeVersion: '["Manual OSLO.pdf"]',
      chunkCount: 1322,
      chunksFileBytes: 38_200_000,
    });
    assert.equal(stats.chunkCount, 1322);
    assert.equal(stats.chunksFileBytes, 38_200_000);
    assert.equal(stats.hasIndex, true);
    assert.equal(stats.indexedAt, "2024-07-03T12:00:00.000Z");
    assert.equal(stats.knowledgeVersion, '["Manual OSLO.pdf"]');
  });

  it("ragStatusFromMeta sin chunkCount usa fallback", () => {
    const stats = ragStatusFromMeta(
      { indexedAt: "2024-01-01T00:00:00.000Z" },
      { chunkCount: 10, chunksFileBytes: 5000 }
    );
    assert.equal(stats.chunkCount, 10);
    assert.equal(stats.chunksFileBytes, 5000);
    assert.equal(stats.hasIndex, true);
  });

  it("ragStatusFromMeta índice vacío", () => {
    const stats = ragStatusFromMeta({
      indexedAt: "2024-01-01T00:00:00.000Z",
      knowledgeVersion: "empty",
      chunkCount: 0,
      chunksFileBytes: 2,
    });
    assert.equal(stats.hasIndex, false);
    assert.equal(stats.chunkCount, 0);
  });
});

describe("chunk-cache-async", () => {
  beforeEach(() => {
    clearAsyncChunkCache();
  });

  it("cachea el resultado del loader", async () => {
    let loads = 0;
    const loader = async (): Promise<StoredChunk[]> => {
      loads++;
      return [{ id: "a", docName: "d", text: "t", embedding: [1] }];
    };

    const first = await getCachedChunksAsync("knowledge:1", loader);
    const second = await getCachedChunksAsync("knowledge:1", loader);

    assert.equal(loads, 1);
    assert.equal(first.length, 1);
    assert.equal(second[0]?.id, "a");
  });

  it("invalida entrada y vuelve a cargar", async () => {
    let loads = 0;
    const loader = async (): Promise<StoredChunk[]> => {
      loads++;
      return [];
    };

    await getCachedChunksAsync("knowledge:2", loader);
    invalidateAsyncChunkCache("knowledge:2");
    await getCachedChunksAsync("knowledge:2", loader);

    assert.equal(loads, 2);
  });
});
