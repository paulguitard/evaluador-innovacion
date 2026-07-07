/** Clasificación ligera de intent knowledge en el cliente (sin server-only). */

const KNOWLEDGE_PATTERNS = [
  /\bmanual\b/i,
  /\boslo\b/i,
  /\bknowledge\b/i,
  /\bmarco\s+te[oó]rico\b/i,
  /\bcap[ií]tulo\s+\d+/i,
  /\bp[aá]gina\s+\d+/i,
  /\bqu[eé]\s+es\s+la\s+innovaci[oó]n\b/i,
  /\bdefinici[oó]n\b.*\binnovaci[oó]n\b/i,
  /\bmedir\b.*\binnovaci[oó]n\b/i,
];

export function isLikelyKnowledgeChatMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return KNOWLEDGE_PATTERNS.some((p) => p.test(m));
}
