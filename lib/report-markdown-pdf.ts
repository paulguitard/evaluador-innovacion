export type MarkdownInline = { text: string; bold: boolean };

export type MarkdownBlock =
  | { type: "h2"; inlines: MarkdownInline[] }
  | { type: "h3"; inlines: MarkdownInline[] }
  | { type: "hr" }
  | { type: "paragraph"; inlines: MarkdownInline[] }
  | { type: "blank" };

/** Parsea **negrita** en segmentos para react-pdf. */
export function parseMarkdownInlines(line: string): MarkdownInline[] {
  const parts: MarkdownInline[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parts.push({ text: line.slice(last, m.index), bold: false });
    }
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    parts.push({ text: line.slice(last), bold: false });
  }
  if (parts.length === 0 && line.length > 0) {
    parts.push({ text: line, bold: false });
  }
  return parts;
}

function stripHeadingMarkers(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").replace(/^\*\*|\*\*$/g, "").trim();
}

/** Parser ligero para informes de evaluación (##, ###, **, ---). */
export function parseReportMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const joined = paragraphLines.join(" ").trim();
    paragraphLines = [];
    if (joined) {
      blocks.push({ type: "paragraph", inlines: parseMarkdownInlines(joined) });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== "blank") {
        blocks.push({ type: "blank" });
      }
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "hr" });
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      flushParagraph();
      blocks.push({
        type: "h3",
        inlines: parseMarkdownInlines(stripHeadingMarkers(trimmed)),
      });
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      flushParagraph();
      blocks.push({
        type: "h2",
        inlines: parseMarkdownInlines(stripHeadingMarkers(trimmed)),
      });
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();
  return blocks;
}
