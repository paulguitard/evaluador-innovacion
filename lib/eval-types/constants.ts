import type { RubricType } from "@/lib/rubric-config";

/** Tipos de evaluación fijos en la aplicación (no se crean ni eliminan desde UI). */
export const FIXED_EVAL_TYPE_KEYS = ["IGIP", "IMET"] as const;

export type FixedEvalTypeKey = (typeof FIXED_EVAL_TYPE_KEYS)[number];

export function normalizeEvalTypeName(name?: string | null): string {
  return (name ?? "").trim().toUpperCase();
}

export function isFixedEvalTypeName(name?: string | null): boolean {
  const n = normalizeEvalTypeName(name);
  return FIXED_EVAL_TYPE_KEYS.some((k) => n === k || n.includes(k));
}

export function isIgip(name?: string | null): boolean {
  return normalizeEvalTypeName(name).includes("IGIP");
}

export function isImet(name?: string | null): boolean {
  return normalizeEvalTypeName(name).includes("IMET");
}

/** IGIP → ponderaciones; IMET → niveles. Cualquier otro nombre se trata como IGIP. */
export function rubricTypeFor(name?: string | null): RubricType {
  if (isImet(name)) return "niveles";
  return "ponderaciones";
}

export function fixedKeyFor(name?: string | null): FixedEvalTypeKey {
  if (isImet(name)) return "IMET";
  return "IGIP";
}

export function canonicalFixedName(key: FixedEvalTypeKey): string {
  return key;
}
