import { getConfig, updateConfig } from "@/lib/db";
import { indexKnowledge } from "@/lib/rag-index";

export type KnowledgeEntry = { name: string; url: string };

export function mergeKnowledgeEntries(
  current: unknown,
  uploaded: KnowledgeEntry[]
): KnowledgeEntry[] {
  const existing: KnowledgeEntry[] = (() => {
    try {
      const raw = Array.isArray(current) ? current : JSON.parse(String(current || "[]"));
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (e): e is KnowledgeEntry => typeof e === "object" && e?.name != null && e?.url != null
      );
    } catch {
      return [];
    }
  })();
  return [...existing, ...uploaded];
}

export async function registerKnowledgeUploads(
  evaluationTypeId: number,
  uploaded: KnowledgeEntry[]
): Promise<{
  saved: string[];
  knowledge_paths: KnowledgeEntry[];
  chunkCount?: number;
  indexError?: string;
}> {
  const config = await getConfig(evaluationTypeId);
  const current = (() => {
    try {
      return JSON.parse(config?.knowledge_paths || "[]");
    } catch {
      return [];
    }
  })();
  const newEntries = mergeKnowledgeEntries(current, uploaded);
  await updateConfig(evaluationTypeId, { knowledge_paths: newEntries });

  let chunkCount: number | undefined;
  let indexError: string | undefined;
  try {
    const result = await indexKnowledge(evaluationTypeId, {
      reindexDocNames: uploaded.map((u) => u.name),
    });
    chunkCount = result.chunkCount;
  } catch (e) {
    indexError = e instanceof Error ? e.message : String(e);
  }

  return {
    saved: uploaded.map((u) => u.name),
    knowledge_paths: newEntries,
    chunkCount,
    indexError,
  };
}
