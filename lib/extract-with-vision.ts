import path from "path";
import fs from "fs";
import { chatCompletionVision } from "@/lib/openrouter";

const EXTRACT_PROMPT = `Extrae todo el texto visible del documento en la imagen. Preséntalo ordenado y estructurado con secciones claras, por ejemplo:
- Nombre del proyecto
- Objetivo general
- Objetivos específicos (numerados 1, 2, 3...)
- Otros datos relevantes (beneficiarios, equipo, fechas, etc.)

No inventes contenido. Respeta el orden y la numeración del documento original. Responde solo con el texto extraído, sin introducciones ni comentarios.`;

/** Image types we send directly to vision (no conversion). */
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * Convert a file to an array of image payloads (mime + base64) for vision API.
 * Only image files (JPG, PNG, etc.) are supported here. PDF and Office are not
 * converted (would require native/WASM deps that break the Next.js build).
 */
export async function fileToImageBuffers(
  filePath: string,
  _options?: { maxPages?: number }
): Promise<{ mime: string; base64: string }[]> {
  if (!fs.existsSync(filePath)) return [];
  const ext = path.extname(filePath).toLowerCase();

  if (IMAGE_EXT.has(ext)) {
    const buf = fs.readFileSync(filePath);
    const base64 = buf.toString("base64");
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
    return [{ mime, base64 }];
  }

  return [];
}

const MSG_NO_IMAGES =
  "[Extracción por IA visión solo disponible para imágenes (JPG, PNG, WebP). Para Excel o Word, exporte el documento a PDF o guarde como imagen y súbalo.]";
const MSG_VISION_ERROR = "[Error al extraer con IA visión. Compruebe la conexión y la API key.]";

/**
 * Extract text from a document using vision AI only. No fallback to library extraction.
 */
export async function extractTextWithVision(
  filePath: string,
  options?: { maxPages?: number }
): Promise<string> {
  const images = await fileToImageBuffers(filePath, options);
  if (images.length === 0) {
    return MSG_NO_IMAGES;
  }

  const parts: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const { mime, base64 } = images[i];
    const url = `data:${mime};base64,${base64}`;
    try {
      const content = await chatCompletionVision([
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "image_url", image_url: { url } },
          ],
        },
      ]);
      const trimmed = (content ?? "").trim();
      if (trimmed) {
        if (images.length > 1) {
          parts.push(`--- Página ${i + 1} ---\n\n${trimmed}`);
        } else {
          parts.push(trimmed);
        }
      }
    } catch {
      return MSG_VISION_ERROR;
    }
  }

  if (parts.length === 0) {
    return MSG_VISION_ERROR;
  }
  return parts.join("\n\n");
}
