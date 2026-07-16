import type { ElementDefConfig } from "@/lib/evaluation-type-settings";

export const SECTION_COLORS: { bg: string; border: string; card: string }[] = [
  { bg: "bg-sky-100 dark:bg-sky-900/40", border: "border-sky-400 dark:border-sky-600", card: "bg-sky-200/80 dark:bg-sky-800/60 border-sky-300 dark:border-sky-700" },
  { bg: "bg-emerald-100 dark:bg-emerald-900/40", border: "border-emerald-400 dark:border-emerald-600", card: "bg-emerald-200/80 dark:bg-emerald-800/60 border-emerald-300 dark:border-emerald-700" },
  { bg: "bg-amber-100 dark:bg-amber-900/40", border: "border-amber-400 dark:border-amber-600", card: "bg-amber-200/80 dark:bg-amber-800/60 border-amber-300 dark:border-amber-700" },
  { bg: "bg-violet-100 dark:bg-violet-900/40", border: "border-violet-400 dark:border-violet-600", card: "bg-violet-200/80 dark:bg-violet-800/60 border-violet-300 dark:border-violet-700" },
  { bg: "bg-rose-100 dark:bg-rose-900/40", border: "border-rose-400 dark:border-rose-600", card: "bg-rose-200/80 dark:bg-rose-800/60 border-rose-300 dark:border-rose-700" },
  { bg: "bg-teal-100 dark:bg-teal-900/40", border: "border-teal-400 dark:border-teal-600", card: "bg-teal-200/80 dark:bg-teal-800/60 border-teal-300 dark:border-teal-700" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", border: "border-orange-400 dark:border-orange-600", card: "bg-orange-200/80 dark:bg-orange-800/60 border-orange-300 dark:border-orange-700" },
  { bg: "bg-indigo-100 dark:bg-indigo-900/40", border: "border-indigo-400 dark:border-indigo-600", card: "bg-indigo-200/80 dark:bg-indigo-800/60 border-indigo-300 dark:border-indigo-700" },
];

export function normSection(s: string) {
  return (s || "General").trim() || "General";
}

export function getSectionColor(elements: ElementDefConfig[], sectionName: string) {
  const ordered = Array.from(new Set(elements.map((e) => e.section ?? "General")));
  const idx = ordered.indexOf(sectionName);
  return SECTION_COLORS[Math.max(0, idx) % SECTION_COLORS.length];
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
