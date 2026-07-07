import { isKnowledgeConfigured, loadActiveChunks } from "@/lib/knowledge-config";
import type { StoredChunk } from "@/lib/vector-store";
import { normalizeDocText, type PageChunk } from "@/lib/page-lookup";

export type ChapterOutlineSection = {
  number: string;
  title: string;
  page?: number;
};

function parseChunkIndex(id: string): number {
  const m = id.match(/-(\d+)$/);
  return m ? Number(m[1]) : -1;
}

/** Cabecera de capítulo en el cuerpo (no confundir con líneas del índice "Chapter N. .... 27"). */
const BODY_CHAPTER_RE = /(?:CHAPTER|CAP[ÍI]TULO)\s+(\d+)\./gi;

function findBodyChapterIndices(all: StoredChunk[], chapterNum: number): number[] {
  const indices: number[] = [];
  for (const c of all) {
    const norm = normalizeDocText(c.text);
    for (const m of norm.matchAll(BODY_CHAPTER_RE)) {
      if (Number(m[1]) === chapterNum) {
        const idx = parseChunkIndex(c.id);
        if (idx >= 0) indices.push(idx);
      }
    }
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

const TOC_LINE_RE = /^(\d+\.\d+(?:\.\d+)?)\.\s+(.+?)\.{2,}\s*(\d{1,4})\s*$/;

function isTocEntryLine(line: string): boolean {
  return /\.{4,}\s*\d{1,4}\s*$/.test(line.trim());
}
/** Subsecciones de tres niveles en el cuerpo (p. ej. 1.2.5.), nunca párrafos 1.22. */
const BODY_SUBSECTION_RE = /(\d+\.\d+\.\d+)\.\s+([A-Z][^\n]{4,120})/g;

function belongsToChapter(sectionNum: string, chapterNum: number): boolean {
  return Number(sectionNum.split(".")[0]) === chapterNum;
}

/**
 * Secciones del capítulo según el índice (tabla de contenidos).
 */
export function parseChapterOutlineFromToc(
  all: StoredChunk[],
  chapterNum: number
): ChapterOutlineSection[] {
  const seen = new Map<string, ChapterOutlineSection>();
  for (const c of all) {
    const norm = c.text.replace(/\u2502/g, "|");
    for (const line of norm.split(/\r?\n/)) {
      if (!isTocEntryLine(line)) continue;
      const m = line.trim().match(TOC_LINE_RE);
      if (!m) continue;
      const num = m[1];
      if (!belongsToChapter(num, chapterNum)) continue;
      const title = m[2].replace(/\s+/g, " ").trim();
      const page = Number(m[3]);
      const prev = seen.get(num);
      if (!prev || (prev.page == null || page < prev.page)) {
        seen.set(num, { number: num, title, page });
      }
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.number.localeCompare(b.number, undefined, { numeric: true })
  );
}

/**
 * Complementa el índice con subsecciones de tres niveles del cuerpo (1.2.3., 1.2.5., etc.).
 * No usa párrafos numerados de dos niveles (1.22., 1.31.), que no son secciones del índice.
 */
export function parseChapterOutlineFromBody(
  chapterChunks: StoredChunk[],
  chapterNum: number
): ChapterOutlineSection[] {
  const seen = new Map<string, ChapterOutlineSection>();
  for (const c of chapterChunks) {
    for (const m of c.text.matchAll(BODY_SUBSECTION_RE)) {
      const num = m[1];
      if (!belongsToChapter(num, chapterNum)) continue;
      const title = m[2].replace(/\s+/g, " ").trim();
      if (title.length < 5) continue;
      if (!seen.has(num)) seen.set(num, { number: num, title });
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.number.localeCompare(b.number, undefined, { numeric: true })
  );
}

export function mergeChapterOutlines(
  toc: ChapterOutlineSection[],
  body: ChapterOutlineSection[]
): ChapterOutlineSection[] {
  const merged = new Map<string, ChapterOutlineSection>();
  for (const s of toc) merged.set(s.number, { ...s });
  for (const s of body) {
    const prev = merged.get(s.number);
    merged.set(s.number, {
      number: s.number,
      title: prev?.title ?? s.title,
      page: prev?.page ?? s.page,
    });
  }
  return [...merged.values()].sort((a, b) =>
    a.number.localeCompare(b.number, undefined, { numeric: true })
  );
}

export function getChapterOutline(
  all: StoredChunk[],
  chapterChunks: StoredChunk[],
  chapterNum: number
): ChapterOutlineSection[] {
  return mergeChapterOutlines(
    parseChapterOutlineFromToc(all, chapterNum),
    parseChapterOutlineFromBody(chapterChunks, chapterNum)
  );
}

export function formatChapterOutline(outline: ChapterOutlineSection[]): string {
  if (outline.length === 0) return "(No se pudo extraer el índice del capítulo.)";
  return outline
    .map((s) => {
      const page = s.page != null ? ` (p. ${s.page})` : "";
      return `- **${s.number}.** ${s.title}${page}`;
    })
    .join("\n");
}

export function buildChapterResponseTemplate(
  chapterNum: number,
  outline: ChapterOutlineSection[]
): string {
  if (outline.length === 0) return "";
  return [
    "## Formato obligatorio de la respuesta",
    "",
    "Incluye **todas** las secciones del índice, **en orden**, cada una con encabezado Markdown propio (`### N.N Título`):",
    "",
    ...outline.map((s) => `- ### ${s.number} ${s.title}`),
    "",
    "Bajo cada encabezado escribe 2–5 oraciones resumiendo solo lo que dice el texto de esa sección.",
    "**Prohibido** omitir secciones del índice o saltar de una numeración a otra sin el encabezado intermedio.",
    "**Prohibido** sustituir una sección entera por la frase «resumen anticipado» o fusionar dos encabezados en una línea.",
    "Si una subsección describe contenido de otra parte del documento, indícalo **dentro del párrafo** de esa subsección (p. ej. «Anticipa el Capítulo 2: …»), pero conserva el encabezado y el resumen de la subsección.",
  ].join("\n");
}

export function buildChapterContextRules(chapterNum: number, outline: ChapterOutlineSection[]): string {
  const topLevel = outline
    .filter((s) => s.number.split(".").length === 2)
    .map((s) => s.number)
    .join(", ");
  const allowed = outline.map((s) => s.number).join(", ");

  const rules: string[] = [
    "## Estructura del capítulo (extraída del documento de referencia indexado)",
    "",
    formatChapterOutline(outline),
    "",
    buildChapterResponseTemplate(chapterNum, outline),
    "",
    "## Reglas obligatorias para el resumen",
    "",
  ];

  if (outline.length > 0) {
    rules.push(`- Usa **solo** estas secciones como encabezados: ${allowed}.`);
    if (topLevel) {
      rules.push(
        `- Secciones principales detectadas: ${topLevel}. Debes incluir **cada una** con su encabezado y contenido; no inventes numeración adicional.`
      );
    }
    rules.push(
      `- No confundas numeración interna del documento (párrafos, notas al pie, etc.) con secciones del índice.`
    );
  } else {
    rules.push(
      `- No se detectó un índice estructurado en el knowledge. Organiza el resumen según las secciones que aparezcan explícitamente en el texto, sin inventar numeración.`
    );
  }

  rules.push(
    `- No incluyas al final avisos sobre «fragmentos proporcionados», «knowledge» ni disclaimers meta.`,
    `- Responde en español.`
  );

  return rules.join("\n");
}

/**
 * Mapa capítulo → página impresa de inicio (desde líneas del índice).
 */
export function parseChapterStartPagesFromToc(all: StoredChunk[]): Map<number, number> {
  const map = new Map<number, number>();
  const re = /(?:Chapter|Cap[íi]tulo)\s+(\d+)\.[^\n]{0,140}?\.{4,}\s*(\d{1,4})\s/gi;
  for (const c of all) {
    const norm = c.text.replace(/\u2502/g, "|");
    for (const m of norm.matchAll(re)) {
      const ch = Number(m[1]);
      const page = Number(m[2]);
      if (!map.has(ch) || page < map.get(ch)!) {
        map.set(ch, page);
      }
    }
  }
  return map;
}

function resolveChapterBounds(
  all: StoredChunk[],
  chapterNum: number
): { startIdx: number; endIdx: number } | null {
  const starts = findBodyChapterIndices(all, chapterNum);
  if (starts.length === 0) return null;

  const startIdx = starts[0];
  const nextStarts = findBodyChapterIndices(all, chapterNum + 1);
  const endIdx = nextStarts.length > 0 ? nextStarts[0] : Number.MAX_SAFE_INTEGER;

  return { startIdx, endIdx };
}

/**
 * Recupera chunks contiguos de un capítulo (cabeceras CHAPTER/CAPÍTULO N. en el cuerpo).
 */
export async function retrieveChunksForChapter(
  evaluationTypeId: number,
  chapterNum: number,
  maxChars: number
): Promise<PageChunk[]> {
  if (chapterNum < 1 || !(await isKnowledgeConfigured(evaluationTypeId))) return [];
  const all = await loadActiveChunks(evaluationTypeId);
  if (all.length === 0) return [];

  const bounds = resolveChapterBounds(all, chapterNum);
  if (!bounds) return [];

  const matched = all
    .filter((c) => {
      const idx = parseChunkIndex(c.id);
      return idx >= bounds.startIdx && idx < bounds.endIdx;
    })
    .sort((a, b) => parseChunkIndex(a.id) - parseChunkIndex(b.id));

  const tocPages = parseChapterStartPagesFromToc(all);
  const startPage = tocPages.get(chapterNum);

  const out: PageChunk[] = [];
  let total = 0;
  for (const c of matched) {
    if (total + c.text.length > maxChars && out.length > 0) break;
    const printedPage =
      c.printedPage ??
      (() => {
        const norm = normalizeDocText(c.text);
        const header = norm.match(new RegExp(`CHAPTER\\s+${chapterNum}\\.[^\\n]{0,220}\\|\\s*(\\d{1,4})`));
        return header ? Number(header[1]) : startPage;
      })();
    out.push({ ...c, printedPage, score: 1 });
    total += c.text.length;
  }
  return out;
}

export async function getChapterContextForEvaluation(
  evaluationTypeId: number,
  chapterNum: number,
  maxChars: number
): Promise<{ chunks: PageChunk[]; outline: ChapterOutlineSection[]; rules: string } | null> {
  const chunks = await retrieveChunksForChapter(evaluationTypeId, chapterNum, maxChars);
  if (chunks.length === 0) return null;
  const all = await loadActiveChunks(evaluationTypeId);
  const outline = getChapterOutline(all, chunks, chapterNum);
  const rules = buildChapterContextRules(chapterNum, outline);
  return { chunks, outline, rules };
}

/**
 * Varios capítulos para preguntas de comparación (no aplica reglas de resumen de un solo capítulo).
 */
export async function buildMultiChapterComparisonContext(
  evaluationTypeId: number,
  chapterNums: number[],
  maxCharsTotal: number
): Promise<{ chunks: PageChunk[]; text: string } | null> {
  const unique = [...new Set(chapterNums)].filter((n) => n >= 1).sort((a, b) => a - b);
  if (unique.length < 2) return null;

  const perChapter = Math.max(8_000, Math.floor(maxCharsTotal / unique.length));
  const sections: string[] = [];
  const allChunks: PageChunk[] = [];

  for (const num of unique) {
    const batch = await retrieveChunksForChapter(evaluationTypeId, num, perChapter);
    if (batch.length === 0) {
      sections.push(
        `## Capítulo ${num}\n\nNo se encontraron fragmentos indexados del Capítulo ${num}.`
      );
      continue;
    }
    allChunks.push(...batch);
    const body = batch
      .map((c) => {
        const pageLabel =
          c.printedPage != null
            ? ` (pág. impresa ${c.printedPage})`
            : c.page != null
              ? ` (PDF ${c.page})`
              : "";
        return `### Fragmento${pageLabel}\n\n${c.text}`;
      })
      .join("\n\n---\n\n");
    sections.push(`## Capítulo ${num} del manual\n\n${body}`);
  }

  if (allChunks.length === 0) return null;

  const text = [
    "## Comparación de capítulos del manual de referencia",
    "",
    "REGLA: El usuario pide COMPARAR estos capítulos. Responde en español con un apartado por capítulo y un apartado «Comparación».",
    "NO uses el formato de resumen sección-por-sección de un solo capítulo (### 2.1, ### 2.2…).",
    "PROHIBIDO usar la rúbrica IGIP. Fundamenta solo en los fragmentos siguientes.",
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");

  return { chunks: allChunks, text };
}
