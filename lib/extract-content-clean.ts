import { normalizeForMatch } from "@/lib/hybrid-search";
import {
  isObjectiveGeneralElement,
  isSpecificObjectivesElement,
} from "@/lib/objective-extract";
import { isFormRowElement } from "@/lib/form-row-extract";

function normKey(text: string): string {
  return normalizeForMatch(text).replace(/\s+/g, " ").trim();
}

/** Quita etiquetas redundantes al inicio del valor extraído. */
export function stripFieldLabels(content: string, elementTitle: string): string {
  let s = content.trim();
  if (!s) return s;

  const labels = [
    elementTitle,
    elementTitle.replace(/\s+del\s+/i, " "),
    elementTitle.replace(/\s+de\s+/i, " "),
  ].filter((l, i, arr) => l && arr.indexOf(l) === i);

  let changed = true;
  while (changed) {
    changed = false;
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^${escaped}\\s*:?\\s*`, "i");
      const next = s.replace(re, "").trim();
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
    const generic = s.replace(/^(objetivo\s+general|objetivos\s+espec[ií]ficos)\s*:?\s*/i, "").trim();
    if (generic !== s) {
      s = generic;
      changed = true;
    }
  }

  return s;
}

function uniqueNonEmptyParts(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const key = normKey(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Elimina líneas o párrafos repetidos (exactos o casi iguales). */
export function deduplicateExtractedContent(content: string, elementTitle?: string): string {
  let s = content.trim();
  if (!s) return s;

  if (elementTitle) {
    s = stripFieldLabels(s, elementTitle);
  }

  const paragraphs = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const blocks = paragraphs.length > 1 ? paragraphs : s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const kept: string[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    let text = elementTitle ? stripFieldLabels(block, elementTitle) : block;
    if (!text) continue;
    const key = normKey(text);
    if (!key) continue;

    let isDup = false;
    for (const prev of seen) {
      if (key === prev) {
        isDup = true;
        break;
      }
      if (key.length > 30 && prev.length > 30 && (key.includes(prev) || prev.includes(key))) {
        isDup = true;
        if (key.length > prev.length) {
          const idx = kept.findIndex((k) => normKey(k) === prev);
          if (idx >= 0) {
            kept[idx] = text;
            seen.delete(prev);
            seen.add(key);
          }
        }
        break;
      }
    }
    if (!isDup) {
      kept.push(text);
      seen.add(key);
    }
  }

  if (kept.length === 0) return s;
  if (kept.length === 1) return kept[0];
  return kept.join("\n\n");
}

/** Une partes de celdas adyacentes sin repetir valores idénticos. */
export function joinUniqueParts(parts: string[]): string {
  return uniqueNonEmptyParts(parts).join("\n");
}

/** Elimina texto de objetivos que se filtró en campos de metadata (Sede, Escuelas, etc.). */
export function stripLeakedObjectiveSections(content: string): string {
  const t = content.trim();
  if (!t) return t;
  const markers = [/OBJETIVO\s+GENERAL\s*:/i, /OBJETIVOS\s+ESPEC[IÍ]FICOS\s*:/i];
  let cutAt = t.length;
  for (const re of markers) {
    const m = t.match(re);
    if (m?.index != null && m.index > 0 && m.index < cutAt) {
      cutAt = m.index;
    }
  }
  return t.slice(0, cutAt).trim();
}

/** Corta antes de la siguiente sección típica del formulario (p. ej. objetivos específicos). */
export function truncateAtNextSection(content: string, elementTitle: string): string {
  const t = content.trim();
  if (!t) return t;

  const stopPatterns = [/objetivos\s+espec[ií]ficos/i, /desarrollo\s+t[eé]cnico\s+del\s+proyecto/i];
  if (/objetivo\s+general/i.test(elementTitle)) {
    for (const re of stopPatterns) {
      const m = t.match(re);
      if (m?.index != null && m.index > 0) {
        return t.slice(0, m.index).trim();
      }
    }
  }
  return t;
}

/** Elimina metadatos de indexación RAG tipo "(fila 12, col 3):". */
export function stripIndexedCellMetadata(content: string): string {
  return content
    .replace(/\(fila\s+\d+,\s*col\s+\d+\):\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function finalizeContentForElement(
  content: string,
  element: { title: string; description?: string }
): string {
  let s = stripIndexedCellMetadata(content.trim());
  if (
    !isObjectiveGeneralElement(element) &&
    !isSpecificObjectivesElement(element)
  ) {
    s = stripLeakedObjectiveSections(s);
  }
  s = truncateAtNextSection(s, element.title);
  if (isFormRowElement(element)) {
    return deduplicateExtractedContent(s);
  }
  return deduplicateExtractedContent(s, element.title);
}
