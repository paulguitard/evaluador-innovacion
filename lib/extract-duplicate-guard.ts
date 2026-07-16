import { normalizeForMatch } from "@/lib/text-match";
import type { ElementRow } from "@/lib/project-extract-pipeline";
import type { ExtractDuplicateGuardConfig } from "@/lib/evaluation-type-settings";
import { defaultExtractDuplicateGuardConfig } from "@/lib/eval-types/extract-config-defaults";
import { applyPromptTemplate } from "@/lib/eval-types/prompt-defaults";

const DEFAULT_DUPLICATE = defaultExtractDuplicateGuardConfig();

function duplicateConfig(config?: ExtractDuplicateGuardConfig): ExtractDuplicateGuardConfig {
  if (!config) return DEFAULT_DUPLICATE;
  return {
    minCompareChars: config.minCompareChars ?? DEFAULT_DUPLICATE.minCompareChars,
    similarityThreshold: config.similarityThreshold ?? DEFAULT_DUPLICATE.similarityThreshold,
    retryHintBody: config.retryHintBody?.trim() || DEFAULT_DUPLICATE.retryHintBody,
  };
}

export function normalizeContentForCompare(text: string): string {
  return normalizeForMatch(text).replace(/\s+/g, " ").trim();
}

/** Similitud 0–1 por proporción del texto más corto contenido en el más largo. */
export function contentSimilarity(
  a: string,
  b: string,
  config?: ExtractDuplicateGuardConfig
): number {
  const cfg = duplicateConfig(config);
  const na = normalizeContentForCompare(a);
  const nb = normalizeContentForCompare(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length < cfg.minCompareChars) return 0;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  return 0;
}

export function areContentsDuplicate(
  a: string,
  b: string,
  config?: ExtractDuplicateGuardConfig
): boolean {
  return contentSimilarity(a, b, config) >= duplicateConfig(config).similarityThreshold;
}

export type DuplicateContentGroup = {
  titles: string[];
  sharedContent: string;
};

/** Agrupa elementos cuyo contenido extraído es igual o casi igual. */
export function findDuplicateContentGroups(
  rows: ElementRow[],
  config?: ExtractDuplicateGuardConfig
): DuplicateContentGroup[] {
  const cfg = duplicateConfig(config);
  const groups: DuplicateContentGroup[] = [];
  const used = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    const ca = a.content.trim();
    if (!ca || ca.length < cfg.minCompareChars || used.has(a.element)) continue;

    const titles = [a.element];
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (areContentsDuplicate(ca, b.content, cfg)) {
        titles.push(b.element);
      }
    }

    if (titles.length > 1) {
      for (const t of titles) used.add(t);
      groups.push({ titles, sharedContent: ca });
    }
  }
  return groups;
}

export function buildDuplicateRetryHint(
  elementTitle: string,
  otherTitles: string[],
  duplicatedContent: string,
  config?: ExtractDuplicateGuardConfig
): string {
  const cfg = duplicateConfig(config);
  const preview = duplicatedContent.slice(0, 220).replace(/\s+/g, " ");
  const body = applyPromptTemplate(cfg.retryHintBody, {
    elementTitle,
    otherTitles: otherTitles.join(", "),
    preview,
  });
  return `\n\n${body}`;
}
