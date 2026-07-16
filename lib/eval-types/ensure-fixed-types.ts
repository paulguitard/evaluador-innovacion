import { createEvaluationTypePostgres, getEvaluationTypesPostgres, deleteEvaluationTypePostgres } from "@/lib/db-postgres";
import {
  FIXED_EVAL_TYPE_KEYS,
  canonicalFixedName,
  isFixedEvalTypeName,
  normalizeEvalTypeName,
  type FixedEvalTypeKey,
} from "./constants";

export type EnsuredEvalType = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

/**
 * Garantiza filas IGIP e IMET. No recrea config si el tipo ya existe.
 * Elimina tipos que no sean IGIP/IMET (p. ej. TRL/TRI).
 */
export async function ensureFixedEvaluationTypes(): Promise<EnsuredEvalType[]> {
  const existing = await getEvaluationTypesPostgres();
  const byKey = new Map<FixedEvalTypeKey, EnsuredEvalType>();

  for (const row of existing) {
    const n = normalizeEvalTypeName(row.name);
    if (n.includes("IGIP") && !byKey.has("IGIP")) {
      byKey.set("IGIP", row);
    } else if (n.includes("IMET") && !byKey.has("IMET")) {
      byKey.set("IMET", row);
    }
  }

  for (const key of FIXED_EVAL_TYPE_KEYS) {
    if (!byKey.has(key)) {
      const name = canonicalFixedName(key);
      const id = await createEvaluationTypePostgres(name);
      byKey.set(key, {
        id,
        name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  for (const row of existing) {
    if (!isFixedEvalTypeName(row.name)) {
      try {
        await deleteEvaluationTypePostgres(row.id);
      } catch {
        // Proyectos huérfanos: se ignora el fallo de borrado para no tumbar el listado.
      }
    } else {
      // Duplicados del mismo key (p. ej. dos "IGIP"): conservar el primero, borrar el resto.
      const key: FixedEvalTypeKey = normalizeEvalTypeName(row.name).includes("IMET") ? "IMET" : "IGIP";
      const kept = byKey.get(key);
      if (kept && kept.id !== row.id) {
        try {
          await deleteEvaluationTypePostgres(row.id);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return FIXED_EVAL_TYPE_KEYS.map((key) => byKey.get(key)!).filter(Boolean);
}
