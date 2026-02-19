export type TextChunk = { text: string; docName: string; index: number };

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Chunk text by size with overlap. Prefers paragraph boundaries, then sentence boundaries.
 */
export function chunkText(
  text: string,
  docName: string,
  options: { chunkSizeChars?: number; overlapChars?: number } = {}
): TextChunk[] {
  const chunkSize = options.chunkSizeChars ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlapChars ?? DEFAULT_OVERLAP;
  if (!text || chunkSize <= 0) return [];

  const result: TextChunk[] = [];
  const paragraphs = splitIntoParagraphs(text);
  let buffer = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if (para.length >= chunkSize) {
      if (buffer) {
        result.push({ text: buffer.trim(), docName, index: chunkIndex++ });
        buffer = "";
      }
      const sentences = splitIntoSentences(para);
      let sentenceBuffer = "";
      for (const sent of sentences) {
        if (sentenceBuffer.length + sent.length + 1 <= chunkSize) {
          sentenceBuffer += (sentenceBuffer ? " " : "") + sent;
        } else {
          if (sentenceBuffer) {
            result.push({ text: sentenceBuffer.trim(), docName, index: chunkIndex++ });
            const overlapStart = Math.max(0, sentenceBuffer.length - overlap);
            sentenceBuffer = sentenceBuffer.slice(overlapStart) + " " + sent;
          } else {
            result.push({ text: sent.slice(0, chunkSize), docName, index: chunkIndex++ });
            sentenceBuffer = sent.slice(chunkSize - overlap);
          }
        }
      }
      if (sentenceBuffer.trim()) {
        result.push({ text: sentenceBuffer.trim(), docName, index: chunkIndex++ });
      }
      continue;
    }

    if (buffer.length + para.length + 2 <= chunkSize) {
      buffer += (buffer ? "\n\n" : "") + para;
    } else {
      if (buffer) {
        result.push({ text: buffer.trim(), docName, index: chunkIndex++ });
        const overlapStart = Math.max(0, buffer.length - overlap);
        buffer = buffer.slice(overlapStart) + "\n\n" + para;
      } else {
        buffer = para;
      }
    }
  }

  if (buffer.trim()) {
    result.push({ text: buffer.trim(), docName, index: chunkIndex++ });
  }

  return result;
}
