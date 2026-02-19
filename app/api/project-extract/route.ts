import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { extractTextWithVision } from "@/lib/extract-with-vision";
import { extractTextFromFile } from "@/lib/document-parser";
import { extractExcelToStructuredJson } from "@/lib/excel-structured-extract";
import { getConfig } from "@/lib/db";
import { chatCompletion, streamChat } from "@/lib/openrouter";

export const maxDuration = 60;

const LIBRARY_EXTS = [".pdf", ".xlsx", ".xls", ".docx", ".doc"];
const EXCEL_EXTS = [".xlsx"];
const VISION_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

const STRUCTURE_PROMPT = `A continuación se te entrega texto ya extraído de documentos (PDF, Excel, Word o imagen) mediante herramientas de programación. Tu única tarea es darle estructura para una tabla de dos columnas.

Reglas:
- Identifica cada par "elemento" (etiqueta/campo) y su "contenido" (valor/texto asociado).
- Devuelve ÚNICAMENTE líneas con este formato exacto: Elemento | Contenido
- NO resumas ni acortes el contenido: transcribe cada valor de Contenido exactamente tal cual aparece en el texto, sin omitir frases ni párrafos.
- Incluye TODOS los elementos que encuentres.
- Una línea por par. Sin cabecera ni explicaciones, solo líneas Elemento | Contenido.`;

const ELEMENTS_MAP_PROMPT = `Te entrego un JSON que representa el contenido de una o más hojas Excel. Cada hoja tiene:
- sheetName: nombre de la hoja
- cells: array de { row, col, value } (solo celdas con contenido; row y col son números)
- merges: array de { startRow, startCol, endRow, endCol } (zonas de celdas fusionadas)

También te doy una lista de "elementos a identificar". Cada elemento tiene un título y una descripción que indica qué buscar en el documento.

Tu tarea: para cada elemento de la lista, localiza en el JSON el contenido que mejor corresponde a ese elemento según su descripción. Devuelve ÚNICAMENTE un JSON válido, un array de objetos con exactamente dos claves: "element" (el título del elemento tal cual está en la lista) y "content" (el texto encontrado, sin recortar). Si no encuentras contenido para un elemento, usa content: "".

Formato de respuesta (solo este JSON, sin markdown ni texto adicional):
[{"element":"Nombre del elemento","content":"texto encontrado"},...]`;

type ElementDef = { title: string; description: string };
type ElementRow = { element: string; content: string };

function parseElementsTableFromLLM(raw: string): ElementRow[] {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const arr = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is ElementRow => typeof x === "object" && x != null && "element" in x && "content" in x)
      .map((x) => ({ element: String(x.element), content: String(x.content ?? "") }));
  } catch {
    return [];
  }
}

function formatElementsTableAsText(table: ElementRow[]): string {
  return table.map((r) => `${r.element} | ${r.content}`).join("\n");
}

/** Extrae proyecto: Excel → JSON estructurado + opcional mapeo de elementos; otros formatos → texto + LLM Elemento | Contenido. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectFilePaths = Array.isArray(body?.projectFilePaths) ? (body.projectFilePaths as string[]) : [];
    const evaluationTypeId = typeof body?.evaluationTypeId === "number" ? body.evaluationTypeId : null;
    const streamRequested = body?.stream === true;
    if (projectFilePaths.length === 0) {
      return NextResponse.json({ text: "" });
    }

    const structuredFiles: Awaited<ReturnType<typeof extractExcelToStructuredJson>>[] = [];
    const textParts: string[] = [];

    for (const filePath of projectFilePaths) {
      if (!filePath || typeof filePath !== "string") continue;
      const exists = fs.existsSync(filePath);
      if (!exists) {
        textParts.push(`### ${path.basename(filePath)}\n\n[Archivo no encontrado en el servidor.]`);
        continue;
      }
      const ext = path.extname(filePath).toLowerCase();
      if (EXCEL_EXTS.includes(ext)) {
        try {
          const data = await extractExcelToStructuredJson(filePath);
          if (data.sheets.length > 0) structuredFiles.push(data);
        } catch (e) {
          textParts.push(`### ${path.basename(filePath)}\n\n[Error Excel: ${e instanceof Error ? e.message : String(e)}]`);
        }
        continue;
      }
      let text: string;
      try {
        if (LIBRARY_EXTS.includes(ext)) {
          text = await extractTextFromFile(filePath);
          if (!text) text = "[Sin texto extraído.]";
        } else if (VISION_EXTS.includes(ext)) {
          text = await extractTextWithVision(filePath);
          if (!text) text = "[Sin texto extraído.]";
        } else {
          text = `[Formato no soportado: ${ext}. Usa PDF, Excel, Word o imagen (JPG, PNG, WebP).]`;
        }
      } catch (e) {
        text = `[Error: ${e instanceof Error ? e.message : String(e)}]`;
      }
      const isError =
        text.startsWith("[Error") ||
        text.startsWith("[Sin texto") ||
        text.startsWith("[Formato no soportado") ||
        text.startsWith("[Presentación") ||
        text.startsWith("[Archivo no encontrado");
      if (!isError) textParts.push(`### ${path.basename(filePath)}\n\n${text}`);
    }

    // Excel path: structured data + optional elements mapping
    if (structuredFiles.length > 0) {
      const structuredData = { files: structuredFiles };
      let elementsTable: ElementRow[] = [];
      let configElements: ElementDef[] = [];
      if (evaluationTypeId) {
        const config = await getConfig(evaluationTypeId);
        if (config?.elements) {
          try {
            const raw = typeof config.elements === "string" ? config.elements : JSON.stringify(config.elements);
            const parsed = JSON.parse(raw) as unknown[];
            configElements = Array.isArray(parsed)
              ? parsed.filter((e): e is ElementDef => typeof e === "object" && e != null && "title" in e && "description" in e)
              : [];
          } catch {
            configElements = [];
          }
        }
      }
      if (configElements.length > 0) {
        const jsonStr = JSON.stringify(structuredData, null, 0);
        const truncate = 60000;
        const jsonForPrompt = jsonStr.length > truncate ? jsonStr.slice(0, truncate) + "\n...[truncado]" : jsonStr;
        const elementsListStr = configElements
          .map((e) => `- Título: "${e.title}". Descripción: ${e.description}`)
          .join("\n");
        const userContent = `JSON del documento:\n${jsonForPrompt}\n\nElementos a identificar:\n${elementsListStr}`;
        const llmResponse = await chatCompletion(
          [
            { role: "system", content: ELEMENTS_MAP_PROMPT },
            { role: "user", content: userContent },
          ],
          { max_tokens: 8192 }
        );
        elementsTable = parseElementsTableFromLLM(llmResponse?.trim() ?? "[]");
      }
      const text = elementsTable.length > 0 ? formatElementsTableAsText(elementsTable) : "";

      if (streamRequested) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              if (elementsTable.length > 0) {
                for (const row of elementsTable) {
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "element", name: row.element }) + "\n"));
                }
              }
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: "done",
                    text,
                    structuredData: structuredFiles.length ? structuredData : undefined,
                    elementsTable: elementsTable.length ? elementsTable : undefined,
                  }) + "\n"
                )
              );
            } catch (err) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: String(err) }) + "\n"));
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      return NextResponse.json({
        text,
        structured: true,
        structuredData,
        elementsTable: elementsTable.length ? elementsTable : undefined,
      });
    }

    // Non-Excel path: combine text and LLM structure as before
    const combined = textParts.join("\n\n---\n\n").trim();
    if (!combined) {
      return NextResponse.json({ text: "No se pudo extraer texto de los archivos." });
    }
    const truncateLimit = 80000;
    const truncated =
      combined.length > truncateLimit ? combined.slice(0, truncateLimit) + "\n\n[... texto truncado ...]" : combined;

    if (streamRequested) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let fullText = "";
            let buffer = "";
            const sep = " | ";
            for await (const chunk of streamChat(
              [
                {
                  role: "system",
                  content:
                    "Estructuras texto en pares Elemento | Contenido para una tabla. No resumas: transcribe el contenido exactamente tal cual. Incluye todos los elementos. Solo líneas en formato Elemento | Contenido, sin cabecera ni explicaciones.",
                },
                { role: "user", content: `${STRUCTURE_PROMPT}\n\n---\n\n${truncated}` },
              ],
              { max_tokens: 16384 }
            )) {
              fullText += chunk;
              buffer += chunk;
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const idx = line.indexOf(sep);
                if (idx >= 0) {
                  const name = line.slice(0, idx).trim();
                  if (name) {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "element", name }) + "\n"));
                  }
                }
              }
            }
            if (buffer) {
              const idx = buffer.indexOf(sep);
              if (idx >= 0) {
                const name = buffer.slice(0, idx).trim();
                if (name) {
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "element", name }) + "\n"));
                }
              }
            }
            const text = (fullText && fullText.trim()) || combined;
            controller.enqueue(encoder.encode(JSON.stringify({ type: "done", text }) + "\n"));
          } catch (err) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: String(err) }) + "\n"));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const structured = await chatCompletion(
      [
        {
          role: "system",
          content:
            "Estructuras texto en pares Elemento | Contenido para una tabla. No resumas: transcribe el contenido exactamente tal cual. Incluye todos los elementos. Solo líneas en formato Elemento | Contenido, sin cabecera ni explicaciones.",
        },
        { role: "user", content: `${STRUCTURE_PROMPT}\n\n---\n\n${truncated}` },
      ],
      { max_tokens: 16384 }
    );
    const text = (structured && structured.trim()) || combined;
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: String(e), text: "" }, { status: 500 });
  }
}
