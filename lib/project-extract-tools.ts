import {
  loadProjectStructuredIndex,
  type ProjectStructuredFile,
} from "@/lib/project-structured-index";
import { loadProjectChunks, loadProjectIndexMeta } from "@/lib/project-vector-store";
import type { StoredChunk } from "@/lib/vector-store";
import { getExtractRunContext } from "@/lib/extract-run-context";

function formatChunksPlain(chunks: StoredChunk[]): string {
  return chunks
    .map((c) => {
      const pageLabel = c.page != null ? ` (pág. ${c.page})` : "";
      return `### ${c.docName}${pageLabel}\n${c.text}`;
    })
    .join("\n\n---\n\n");
}

export function formatExcelFile(file: ProjectStructuredFile, sheetName?: string, maxCells = 400): string {
  if (!file.sheets?.length) return `No hay hojas en ${file.fileName}.`;
  const sheets = sheetName
    ? file.sheets.filter((s) => s.sheetName.toLowerCase().includes(sheetName.toLowerCase()))
    : file.sheets;
  if (sheets.length === 0) return `No se encontró la hoja "${sheetName}" en ${file.fileName}.`;

  const parts: string[] = [`### ${file.fileName}`];
  let cellCount = 0;
  for (const sheet of sheets) {
    parts.push(`#### Hoja: ${sheet.sheetName}`);
    const cells = [...sheet.cells].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const c of cells) {
      if (cellCount >= maxCells) {
        parts.push("… (truncado)");
        break;
      }
      parts.push(`(fila ${c.row}, col ${c.col}): ${c.value}`);
      cellCount += 1;
    }
  }
  return parts.join("\n");
}

export function formatDocumentPages(
  file: ProjectStructuredFile,
  pageFrom?: number,
  pageTo?: number,
  maxChars = 12_000
): string {
  const parts: string[] = [`### ${file.fileName}`];
  let total = 0;

  if (file.pages?.length) {
    const from = pageFrom ?? 1;
    const to = pageTo ?? file.pages[file.pages.length - 1].page;
    for (const p of file.pages) {
      if (p.page < from || p.page > to) continue;
      const block = `#### Página ${p.page}\n${p.text}`;
      if (total + block.length > maxChars && total > 0) {
        parts.push("… (truncado)");
        break;
      }
      parts.push(block);
      total += block.length;
    }
    return parts.join("\n\n");
  }

  if (file.sections?.length) {
    for (const sec of file.sections) {
      const heading = sec.heading ? `#### ${sec.heading}\n` : "";
      const block = `${heading}${sec.text}`;
      if (total + block.length > maxChars && total > 0) {
        parts.push("… (truncado)");
        break;
      }
      parts.push(block);
      total += block.length;
    }
    return parts.join("\n\n");
  }

  return `Sin páginas ni secciones en ${file.fileName}.`;
}

/** Ejecuta una herramienta de extracción y devuelve texto para el LLM. */
export async function executeProjectExtractTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const index = loadProjectStructuredIndex(sessionId);

  switch (toolName) {
    case "search_project": {
      const rawQueries = Array.isArray(args.queries) ? args.queries : [args.query];
      const queries = rawQueries
        .filter((q): q is string => typeof q === "string")
        .map((q) => q.trim())
        .filter(Boolean);
      if (queries.length === 0) return "Se requiere al menos una consulta.";
      const { retrieveProjectChunksMulti, formatProjectChunksForPrompt } = await import(
        "@/lib/project-rag-retrieve"
      );
      const extractConfig = getExtractRunContext();
      const agent = extractConfig?.agent;
      const retrieve = extractConfig?.projectRetrieve;
      const chunks = await retrieveProjectChunksMulti(sessionId, queries, {
        topK: agent?.toolSearchTopK ?? 18,
        maxRetrievedChars: agent?.toolSearchMaxRetrievedChars ?? 22_000,
        expandNeighbors: (retrieve?.neighborWindow ?? 1) > 0,
      });
      if (chunks.length === 0) return "No se encontraron fragmentos relevantes.";
      return formatProjectChunksForPrompt(chunks);
    }

    case "get_project_overview": {
      const meta = loadProjectIndexMeta(sessionId);
      const chunks = loadProjectChunks(sessionId).slice(0, 8);
      const fileList = index?.files.map((f) => `- ${f.fileName} (${f.type})`).join("\n") ?? "sin archivos";
      const snippets = chunks.length > 0 ? formatChunksPlain(chunks) : "Sin fragmentos indexados.";
      return [
        `Archivos indexados: ${meta?.filePaths?.length ?? 0}`,
        `Fragmentos RAG: ${loadProjectChunks(sessionId).length}`,
        `Indexado: ${meta?.indexedAt ?? "desconocido"}`,
        "\nArchivos:\n" + fileList,
        "\nFragmentos iniciales:\n" + snippets,
      ].join("\n");
    }

    case "get_structured_excel": {
      const fileName = typeof args.fileName === "string" ? args.fileName.trim() : "";
      const sheetName = typeof args.sheetName === "string" ? args.sheetName.trim() : undefined;
      const maxCells = typeof args.maxCells === "number" ? args.maxCells : 400;
      const excelFiles = (index?.files ?? []).filter((f) => f.type === "excel");
      if (excelFiles.length === 0) return "No hay archivos Excel en el proyecto.";
      const targets = fileName
        ? excelFiles.filter((f) => f.fileName.toLowerCase().includes(fileName.toLowerCase()))
        : excelFiles;
      if (targets.length === 0) return `No se encontró Excel "${fileName}".`;
      return targets.map((f) => formatExcelFile(f, sheetName, maxCells)).join("\n\n---\n\n");
    }

    case "get_document_pages": {
      const fileName = typeof args.fileName === "string" ? args.fileName.trim() : "";
      const pageFrom = typeof args.pageFrom === "number" ? args.pageFrom : undefined;
      const pageTo = typeof args.pageTo === "number" ? args.pageTo : undefined;
      const maxChars = typeof args.maxChars === "number" ? args.maxChars : 12_000;
      const docFiles = (index?.files ?? []).filter((f) =>
        ["pdf", "docx", "text", "image"].includes(f.type)
      );
      if (docFiles.length === 0) return "No hay documentos PDF/Word/texto en el proyecto.";
      const targets = fileName
        ? docFiles.filter((f) => f.fileName.toLowerCase().includes(fileName.toLowerCase()))
        : docFiles;
      if (targets.length === 0) return `No se encontró "${fileName}".`;
      return targets.map((f) => formatDocumentPages(f, pageFrom, pageTo, maxChars)).join("\n\n---\n\n");
    }

    default:
      return `Herramienta desconocida: ${toolName}`;
  }
}

/** Búsqueda RAG del proyecto (reutilizable desde agent-tools). */
export async function searchProjectForQuery(
  sessionId: string,
  query: string,
  options?: { topK?: number; maxChars?: number }
): Promise<string> {
  const { retrieveProjectChunksMulti, formatProjectChunksForPrompt } = await import(
    "@/lib/project-rag-retrieve"
  );
  const chunks = await retrieveProjectChunksMulti(sessionId, [query], {
    topK: options?.topK ?? 12,
    maxRetrievedChars: options?.maxChars ?? 14_000,
    expandNeighbors: true,
  });
  if (chunks.length === 0) return "";
  return formatProjectChunksForPrompt(chunks);
}
