import { getGroqClient } from "@/lib/groq";

const EMBEDDING_MODEL = "nomic-embed-text-v1_5";
const BATCH_SIZE = 20;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getGroqClient();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).filter((t) => t?.trim());
    if (batch.length === 0) continue;

    const res = await client.embeddings.create({
      input: batch,
      model: EMBEDDING_MODEL,
      encoding_format: "float",
    });

    const vectors = (res.data ?? [])
      .sort((a, b) => a.index - b.index)
      .map((e) => (typeof e.embedding === "string" ? [] : e.embedding));
    results.push(...vectors);
  }

  return results;
}

export async function embedQuery(query: string): Promise<number[]> {
  const vectors = await embedTexts([query.trim() || " "]);
  return vectors[0] ?? [];
}
