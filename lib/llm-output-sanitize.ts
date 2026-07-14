/**
 * Detecta y colapsa bucles degenerados del LLM
 * (p. ej. "propician mandatos propician mandatos…" miles de veces).
 */

const MAX_PHRASE_WORDS = 8;
const DEFAULT_KEEP = 2;
/** Repeticiones consecutivas adicionales a `keep` que disparan el colapso. */
const EXTRA_BEFORE_COLLAPSE = 3;

type WordSpan = { start: number; end: number; norm: string };

function listWordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const re = /[\p{L}\p{N}'’%\-/]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      norm: m[0].toLowerCase(),
    });
  }
  return spans;
}

function phraseAt(spans: WordSpan[], i: number, n: number): string {
  return spans
    .slice(i, i + n)
    .map((s) => s.norm)
    .join(" ");
}

/**
 * Colapsa n-gramas de palabras que se repiten en cadena de forma anormal.
 * Conserva como máximo `keep` apariciones consecutivas del mismo fraseo.
 */
export function collapseRunawayRepetition(
  text: string,
  keep: number = DEFAULT_KEEP
): string {
  if (!text || text.length < 80) return text;

  const threshold = keep + EXTRA_BEFORE_COLLAPSE;
  let spans = listWordSpans(text);
  if (spans.length < threshold) return text;

  let out = text;
  let changed = true;
  let guard = 0;

  while (changed && guard < 20) {
    changed = false;
    guard += 1;
    spans = listWordSpans(out);

    outer: for (let n = Math.min(MAX_PHRASE_WORDS, Math.floor(spans.length / threshold)); n >= 1; n--) {
      for (let i = 0; i + n * threshold <= spans.length; i++) {
        const phrase = phraseAt(spans, i, n);
        let repeats = 1;
        let j = i + n;
        while (j + n <= spans.length && phraseAt(spans, j, n) === phrase) {
          repeats += 1;
          j += n;
        }
        if (repeats < threshold) continue;

        const keepEnd = spans[i + n * keep - 1]?.end;
        const cutStart = spans[i + n * keep]?.start;
        const cutEnd = spans[j - 1]?.end;
        if (keepEnd == null || cutStart == null || cutEnd == null) continue;

        out = out.slice(0, cutStart) + out.slice(cutEnd);
        changed = true;
        break outer;
      }
    }
  }

  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n");
}

/** Aplica colapso de repetición y limpia espacios extremos. */
export function sanitizeLlmEvaluationText(text: string): string {
  return collapseRunawayRepetition(text).replace(/[ \t]+\n/g, "\n").trim();
}
