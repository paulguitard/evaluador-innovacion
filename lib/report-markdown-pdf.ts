export type MarkdownInline = { text: string; bold: boolean };

export type MarkdownTableBlock = {
  type: "table";
  headers: string[];
  rows: string[][];
};

export type MarkdownBlock =
  | { type: "h2"; inlines: MarkdownInline[] }
  | { type: "h3"; inlines: MarkdownInline[] }
  | { type: "hr" }
  | { type: "paragraph"; inlines: MarkdownInline[] }
  | MarkdownTableBlock
  | { type: "blank" };

/** Fila de tabla Markdown: empieza y termina con | */
export function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2;
}

/** Fila separadora de tabla Markdown, p. ej. | --- | --- | */
export function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!isMarkdownTableRow(trimmed)) return false;
  return trimmed
    .slice(1, -1)
    .split("|")
    .every((cell) => /^[\s:-]+$/.test(cell) && /-{3,}/.test(cell));
}

/** Celdas de una fila de tabla Markdown. */
export function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

/**
 * Repara tablas colapsadas en una sola línea (p. ej. tras unir párrafos con espacios).
 * Los límites entre filas son `| |`; los de celda dentro de fila son ` | `.
 */
export function expandCollapsedMarkdownTableLines(text: string): string {
  return text.replace(/^[^\n]*\|[^\n]*\|[^\n]*$/gm, (line) => {
    if (!/\|\s*---[\s:-]*\|/.test(line)) return line;
    const pipePairs = line.match(/\|\s+\|/g);
    if (!pipePairs || pipePairs.length < 2) return line;
    return line.replace(/\|\s+\|/g, "|\n|");
  });
}

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

function parseMarkdownTableBlock(tableLines: string[]): MarkdownTableBlock | null {
  if (tableLines.length === 0) return null;
  const headers = parseMarkdownTableRow(tableLines[0]!);
  if (headers.length === 0) return null;

  let dataStart = 1;
  if (tableLines.length > 1 && isMarkdownTableSeparator(tableLines[1]!)) {
    dataStart = 2;
  }

  const rows: string[][] = [];
  for (let i = dataStart; i < tableLines.length; i++) {
    const row = parseMarkdownTableRow(tableLines[i]!);
    if (row.length > 0) rows.push(row);
  }

  return { type: "table", headers, rows };
}

/** Parser ligero para informes de evaluación (##, ###, **, ---, tablas). */
export function parseReportMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const normalized = expandCollapsedMarkdownTableLines(text.replace(/\r\n/g, "\n"));
  const lines = normalized.split("\n");
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const joined = paragraphLines.join(" ").trim();
    paragraphLines = [];
    if (!joined) return;

    const expanded = expandCollapsedMarkdownTableLines(joined);
    if (expanded.includes("\n") && expanded.split("\n").every(isMarkdownTableRow)) {
      const table = parseMarkdownTableBlock(expanded.split("\n"));
      if (table) {
        blocks.push(table);
        return;
      }
    }

    blocks.push({ type: "paragraph", inlines: parseMarkdownInlines(joined) });
  };

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]!;
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

    if (isMarkdownTableRow(trimmed)) {
      flushParagraph();
      const tableLines: string[] = [trimmed];
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!.trim();
        if (!next || !isMarkdownTableRow(next)) break;
        index++;
        tableLines.push(next);
      }
      const table = parseMarkdownTableBlock(tableLines);
      if (table) {
        blocks.push(table);
      } else {
        paragraphLines.push(...tableLines);
      }
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();
  return blocks;
}
