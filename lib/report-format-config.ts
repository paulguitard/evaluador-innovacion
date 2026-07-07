import { parseReportFormatLimits } from "@/lib/report-format-limits";
import type { RubricConfig, RubricConfigPonderaciones } from "@/lib/rubric-config";

export type ReportSectionKind =
  | "custom"
  | "dimension_overview"
  | "subdimension_eval"
  | "assigned_level";

/** Sección expandida para runtime (prompt de formateo, límites de evaluación). */
export type ReportSection = {
  id: string;
  title: string;
  description: string;
  minChars: number;
  maxChars: number;
  kind: ReportSectionKind;
  dimensionId?: string;
  subdimensionId?: string;
  locked?: boolean;
};

export type ReportCustomSection = {
  id: string;
  title: string;
  description: string;
  minChars: number;
  maxChars: number;
};

export type ReportFormatConfig = {
  /** Secciones libres al inicio del informe (no vienen predefinidas). */
  preamble: ReportCustomSection[];
  /** Instrucciones generales para todas las dimensiones. */
  dimensionOverviewInstructions: string;
  /** Instrucciones generales para todas las subdimensiones. */
  subdimensionEvalInstructions: string;
  /** Límites de caracteres aplicados a cada dimensión. */
  dimensionOverviewLimits: { minChars: number; maxChars: number };
  /** Límites de caracteres aplicados a cada subdimensión. */
  subdimensionEvalLimits: { minChars: number; maxChars: number };
  /** Secciones libres antes del cierre del informe (p. ej. síntesis final). */
  beforeScores: ReportCustomSection[];
  /** Solo rúbrica niveles: instrucciones y límites del nivel asignado. */
  assignedLevelInstructions?: string;
  assignedLevelLimits?: { minChars: number; maxChars: number };
};

export function newReportSectionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function dimensionOverviewId(dimensionId: string): string {
  return `dim_overview_${dimensionId}`;
}

export function subdimensionEvalId(subdimensionId: string): string {
  return `sub_eval_${subdimensionId}`;
}

export const ASSIGNED_LEVEL_ID = "assigned_level";

const DEFAULT_DIM_OVERVIEW = { minChars: 400, maxChars: 500 };
const DEFAULT_SUB_EVAL = { minChars: 1200, maxChars: 1500 };
const DEFAULT_ASSIGNED_LEVEL = { minChars: 1500, maxChars: 2000 };

export const DEFAULT_SUBDIMENSION_EVAL_INSTRUCTIONS = `Incluye obligatoriamente en esta subdimensión:
1. **Análisis** — evaluación según el proyecto y los criterios de la rúbrica.
2. **Nota** — línea exacta «Nota: N» con la nota asignada según la escala de la rúbrica.
3. **Justificación** — fundamentada en el Knowledge (marco teórico de referencia).
4. **Sugerencias de mejora** — propuestas concretas para mejorar el proyecto en este criterio.`;

export const DEFAULT_DIMENSION_OVERVIEW_INSTRUCTIONS =
  "Resumen macro de la dimensión en conjunto, sintetizando las evaluaciones de sus subdimensiones. Integra hallazgos transversales y conclusión global de la dimensión. No re-evalúes criterios ni asignes notas.";

export const DEFAULT_ASSIGNED_LEVEL_INSTRUCTIONS =
  "Nivel global asignado, análisis de evidencia del proyecto y justificación fundamentada en el Knowledge.";

export function defaultInstructionForSectionKind(kind: ReportSectionKind): string {
  switch (kind) {
    case "dimension_overview":
      return DEFAULT_DIMENSION_OVERVIEW_INSTRUCTIONS;
    case "subdimension_eval":
      return DEFAULT_SUBDIMENSION_EVAL_INSTRUCTIONS;
    case "assigned_level":
      return DEFAULT_ASSIGNED_LEVEL_INSTRUCTIONS;
    default:
      return "";
  }
}

function clampLimits(minChars: number, maxChars: number): { minChars: number; maxChars: number } {
  const max = Math.max(1, Math.round(maxChars));
  const min = Math.min(max, Math.max(1, Math.round(minChars)));
  return { minChars: min, maxChars: max };
}

function customSection(
  partial: Partial<ReportCustomSection> & { title: string }
): ReportCustomSection {
  const limits = clampLimits(
    partial.minChars ?? 100,
    partial.maxChars ?? partial.minChars ?? 500
  );
  return {
    id: partial.id ?? newReportSectionId(),
    title: partial.title,
    description: partial.description ?? "",
    ...limits,
  };
}

export function defaultReportFormatPonderaciones(
  rubric: RubricConfigPonderaciones
): ReportFormatConfig {
  void rubric;
  return {
    preamble: [],
    dimensionOverviewInstructions: DEFAULT_DIMENSION_OVERVIEW_INSTRUCTIONS,
    subdimensionEvalInstructions: DEFAULT_SUBDIMENSION_EVAL_INSTRUCTIONS,
    dimensionOverviewLimits: { ...DEFAULT_DIM_OVERVIEW },
    subdimensionEvalLimits: { ...DEFAULT_SUB_EVAL },
    beforeScores: [],
  };
}

export function defaultReportFormatNiveles(): ReportFormatConfig {
  return {
    preamble: [],
    dimensionOverviewInstructions: "",
    subdimensionEvalInstructions: "",
    dimensionOverviewLimits: { ...DEFAULT_DIM_OVERVIEW },
    subdimensionEvalLimits: { ...DEFAULT_SUB_EVAL },
    beforeScores: [],
    assignedLevelInstructions: DEFAULT_ASSIGNED_LEVEL_INSTRUCTIONS,
    assignedLevelLimits: { ...DEFAULT_ASSIGNED_LEVEL },
  };
}

function firstLegacyLimit(
  limits: Record<string, { minChars: number; maxChars: number }> | undefined,
  prefix: string,
  fallback: { minChars: number; maxChars: number }
): { minChars: number; maxChars: number } {
  if (!limits) return fallback;
  const entry = Object.entries(limits).find(([k]) => k.startsWith(prefix));
  return entry ? clampLimits(entry[1].minChars, entry[1].maxChars) : fallback;
}

function firstLegacyInstruction(
  legacy: Record<string, string> | undefined,
  prefix: string,
  fallback: string
): string {
  if (!legacy) return fallback;
  const entry = Object.entries(legacy).find(([k]) => k.startsWith(prefix));
  return entry?.[1]?.trim() || fallback;
}

/** Normaliza config cruda (incluye formato antiguo con sectionLimits por id). */
function normalizeReportFormatPartial(
  o: Partial<ReportFormatConfig> & {
    sectionLimits?: Record<string, { minChars: number; maxChars: number }>;
    sectionInstructions?: Record<string, string>;
  }
): ReportFormatConfig {
  const legacyLimits = o.sectionLimits;
  const legacyInstr = o.sectionInstructions;

  return {
    preamble: normalizeCustomSections(o.preamble),
    dimensionOverviewInstructions:
      o.dimensionOverviewInstructions?.trim() ||
      firstLegacyInstruction(legacyInstr, "dim_overview_", DEFAULT_DIMENSION_OVERVIEW_INSTRUCTIONS),
    subdimensionEvalInstructions:
      o.subdimensionEvalInstructions?.trim() ||
      firstLegacyInstruction(legacyInstr, "sub_eval_", DEFAULT_SUBDIMENSION_EVAL_INSTRUCTIONS),
    dimensionOverviewLimits: clampLimits(
      o.dimensionOverviewLimits?.minChars ??
        firstLegacyLimit(legacyLimits, "dim_overview_", DEFAULT_DIM_OVERVIEW).minChars,
      o.dimensionOverviewLimits?.maxChars ??
        firstLegacyLimit(legacyLimits, "dim_overview_", DEFAULT_DIM_OVERVIEW).maxChars
    ),
    subdimensionEvalLimits: clampLimits(
      o.subdimensionEvalLimits?.minChars ??
        firstLegacyLimit(legacyLimits, "sub_eval_", DEFAULT_SUB_EVAL).minChars,
      o.subdimensionEvalLimits?.maxChars ??
        firstLegacyLimit(legacyLimits, "sub_eval_", DEFAULT_SUB_EVAL).maxChars
    ),
    beforeScores: normalizeCustomSections(o.beforeScores),
    assignedLevelInstructions:
      o.assignedLevelInstructions?.trim() ||
      legacyInstr?.[ASSIGNED_LEVEL_ID]?.trim() ||
      DEFAULT_ASSIGNED_LEVEL_INSTRUCTIONS,
    assignedLevelLimits: clampLimits(
      o.assignedLevelLimits?.minChars ??
        legacyLimits?.[ASSIGNED_LEVEL_ID]?.minChars ??
        DEFAULT_ASSIGNED_LEVEL.minChars,
      o.assignedLevelLimits?.maxChars ??
        legacyLimits?.[ASSIGNED_LEVEL_ID]?.maxChars ??
        DEFAULT_ASSIGNED_LEVEL.maxChars
    ),
  };
}

export function resolveSectionInstruction(
  config: ReportFormatConfig,
  kind: ReportSectionKind
): string {
  switch (kind) {
    case "dimension_overview":
      return (
        config.dimensionOverviewInstructions?.trim() || DEFAULT_DIMENSION_OVERVIEW_INSTRUCTIONS
      );
    case "subdimension_eval":
      return config.subdimensionEvalInstructions?.trim() || DEFAULT_SUBDIMENSION_EVAL_INSTRUCTIONS;
    case "assigned_level":
      return config.assignedLevelInstructions?.trim() || DEFAULT_ASSIGNED_LEVEL_INSTRUCTIONS;
    default:
      return "";
  }
}

/** Sincroniza con la rúbrica actual; conserva plantillas globales y límites. */
export function syncReportFormatWithRubric(
  config: ReportFormatConfig,
  rubric: RubricConfig
): ReportFormatConfig {
  const base =
    rubric.type === "ponderaciones"
      ? defaultReportFormatPonderaciones(rubric)
      : defaultReportFormatNiveles();

  const normalized = normalizeReportFormatPartial(config);

  return {
    preamble: normalized.preamble.map((s) => ({ ...s, ...clampLimits(s.minChars, s.maxChars) })),
    dimensionOverviewInstructions:
      normalized.dimensionOverviewInstructions || base.dimensionOverviewInstructions,
    subdimensionEvalInstructions:
      normalized.subdimensionEvalInstructions || base.subdimensionEvalInstructions,
    dimensionOverviewLimits: clampLimits(
      normalized.dimensionOverviewLimits.minChars,
      normalized.dimensionOverviewLimits.maxChars
    ),
    subdimensionEvalLimits: clampLimits(
      normalized.subdimensionEvalLimits.minChars,
      normalized.subdimensionEvalLimits.maxChars
    ),
    beforeScores: normalized.beforeScores.map((s) => ({
      ...s,
      ...clampLimits(s.minChars, s.maxChars),
    })),
    assignedLevelInstructions:
      rubric.type === "niveles"
        ? normalized.assignedLevelInstructions || base.assignedLevelInstructions!
        : undefined,
    assignedLevelLimits:
      rubric.type === "niveles"
        ? clampLimits(
            normalized.assignedLevelLimits!.minChars,
            normalized.assignedLevelLimits!.maxChars
          )
        : undefined,
  };
}

function isLegacySectionsArray(raw: unknown): raw is { sections: unknown[] } {
  return (
    !!raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { sections?: unknown }).sections)
  );
}

function migrateLegacySections(
  sections: {
    id?: string;
    title?: string;
    description?: string;
    maxChars?: number;
    minChars?: number;
    kind?: string;
    dimensionId?: string;
    subdimensionId?: string;
  }[],
  rubric?: RubricConfig
): ReportFormatConfig {
  const preamble: ReportCustomSection[] = [];
  const beforeScores: ReportCustomSection[] = [];
  const sectionLimits: Record<string, { minChars: number; maxChars: number }> = {};
  let dimInstruction = "";
  let subInstruction = "";
  let assignedInstruction = "";
  let seenRubric = false;

  for (const s of sections) {
    const max = Number(s.maxChars) || 500;
    const min = Number(s.minChars) || Math.floor(max * 0.9);
    const limits = clampLimits(min, max);

    if (
      s.kind === "custom" ||
      s.kind === "project_summary" ||
      s.kind === "synthesis"
    ) {
      const custom = customSection({
        id: s.id,
        title: s.title ?? "Sección",
        description: s.description ?? "",
        ...limits,
      });
      if (!seenRubric) preamble.push(custom);
      else beforeScores.push(custom);
      continue;
    }

    if (s.kind === "dimension_overview" && s.dimensionId) {
      seenRubric = true;
      const key = dimensionOverviewId(s.dimensionId);
      sectionLimits[key] = limits;
      if (s.description?.trim() && !dimInstruction) dimInstruction = s.description.trim();
      continue;
    }
    if (s.kind === "subdimension_eval" && s.subdimensionId) {
      seenRubric = true;
      const key = subdimensionEvalId(s.subdimensionId);
      sectionLimits[key] = limits;
      if (s.description?.trim() && !subInstruction) subInstruction = s.description.trim();
      continue;
    }
    if (s.kind === "scores_summary") {
      continue;
    }
    if (s.kind === "assigned_level") {
      sectionLimits[ASSIGNED_LEVEL_ID] = limits;
      if (s.description?.trim()) assignedInstruction = s.description.trim();
      continue;
    }
  }

  const merged = normalizeReportFormatPartial({
    preamble,
    beforeScores,
    sectionLimits,
    dimensionOverviewInstructions: dimInstruction,
    subdimensionEvalInstructions: subInstruction,
    assignedLevelInstructions: assignedInstruction,
  });
  return rubric ? syncReportFormatWithRubric(merged, rubric) : merged;
}

function normalizeCustomSections(raw: unknown): ReportCustomSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === "object" && typeof (s as ReportCustomSection).title === "string")
    .map((s) => {
      const o = s as ReportCustomSection;
      return customSection({
        id: typeof o.id === "string" ? o.id : undefined,
        title: o.title.trim(),
        description: typeof o.description === "string" ? o.description : "",
        minChars: Number(o.minChars),
        maxChars: Number(o.maxChars),
      });
    });
}

export function mergeReportFormatConfig(
  raw: unknown,
  rubric?: RubricConfig
): ReportFormatConfig {
  if (isLegacySectionsArray(raw)) {
    return syncReportFormatWithRubric(
      migrateLegacySections(raw.sections as Parameters<typeof migrateLegacySections>[0], rubric),
      rubric ?? { type: "ponderaciones", scoreScale: { min: 1, max: 4 }, dimensions: [] }
    );
  }

  if (!raw || typeof raw !== "object") {
    if (rubric?.type === "niveles") return defaultReportFormatNiveles();
    if (rubric?.type === "ponderaciones") return defaultReportFormatPonderaciones(rubric);
    return defaultReportFormatNiveles();
  }

  const o = raw as Partial<ReportFormatConfig> & {
    sectionLimits?: Record<string, { minChars: number; maxChars: number }>;
    sectionInstructions?: Record<string, string>;
  };
  const partial = normalizeReportFormatPartial(o);

  if (!rubric) return partial;
  return syncReportFormatWithRubric(partial, rubric);
}

/**
 * Garantiza secciones §6 estándar (Resumen del proyecto, Síntesis final) cuando
 * el JSON no las tiene pero el texto legacy o los defaults IGIP sí las definen.
 */
export function enrichReportFormatWithLegacySections(
  config: ReportFormatConfig,
  rubric: RubricConfig,
  legacyReportFormat?: string
): ReportFormatConfig {
  let synced = syncReportFormatWithRubric(config, rubric);
  const hasResumen = synced.preamble.some((s) =>
    /resumen.*proyecto|proyecto.*resumen/i.test(s.title)
  );
  const hasSynthesis = synced.beforeScores.some((s) => /síntesis|sintesis/i.test(s.title));

  if (hasResumen && hasSynthesis) return synced;

  const legacy = legacyReportFormat?.trim() ?? "";
  const parsed = legacy ? parseReportFormatFromLegacyText(legacy, rubric) : null;
  const limits = legacy ? parseReportFormatLimits(legacy) : null;

  const preamble = [...synced.preamble];
  const beforeScores = [...synced.beforeScores];

  if (!hasResumen) {
    const fromParsed = parsed?.preamble.find((s) =>
      /resumen.*proyecto|proyecto.*resumen/i.test(s.title)
    );
    preamble.unshift(
      fromParsed ??
        customSection({
          title: "Resumen del proyecto",
          description: "Síntesis breve del proyecto evaluado.",
          minChars: limits ? Math.floor(limits.summary * 0.9) : 900,
          maxChars: limits?.summary ?? 1000,
        })
    );
  }

  if (!hasSynthesis) {
    const fromParsed = parsed?.beforeScores.find((s) => /síntesis|sintesis/i.test(s.title));
    beforeScores.push(
      fromParsed ??
        customSection({
          title: "Síntesis final",
          description: "Conclusión global de la evaluación.",
          minChars: limits ? Math.floor(limits.synthesis * 0.9) : 900,
          maxChars: limits?.synthesis ?? 1000,
        })
    );
  }

  return syncReportFormatWithRubric({ ...synced, preamble, beforeScores }, rubric);
}

export function expandReportSections(
  rubric: RubricConfig,
  config: ReportFormatConfig
): ReportSection[] {
  const synced = syncReportFormatWithRubric(config, rubric);
  const out: ReportSection[] = [];

  const pushCustom = (s: ReportCustomSection) => {
    out.push({
      id: s.id,
      title: s.title,
      description: s.description,
      minChars: s.minChars,
      maxChars: s.maxChars,
      kind: "custom",
      locked: false,
    });
  };

  for (const s of synced.preamble) pushCustom(s);

  if (rubric.type === "ponderaciones") {
    const dimInstr = resolveSectionInstruction(synced, "dimension_overview");
    const subInstr = resolveSectionInstruction(synced, "subdimension_eval");
    for (const dim of rubric.dimensions) {
      const dimId = dimensionOverviewId(dim.id);
      out.push({
        id: dimId,
        title: `Dimensión: ${dim.name}`,
        description: dimInstr,
        ...synced.dimensionOverviewLimits,
        kind: "dimension_overview",
        dimensionId: dim.id,
        locked: true,
      });
      for (const sub of dim.subdimensions) {
        const subId = subdimensionEvalId(sub.id);
        out.push({
          id: subId,
          title: sub.name,
          description: subInstr,
          ...synced.subdimensionEvalLimits,
          kind: "subdimension_eval",
          dimensionId: dim.id,
          subdimensionId: sub.id,
          locked: true,
        });
      }
    }
  } else {
    out.push({
      id: ASSIGNED_LEVEL_ID,
      title: "Nivel asignado",
      description: resolveSectionInstruction(synced, "assigned_level"),
      ...(synced.assignedLevelLimits ?? DEFAULT_ASSIGNED_LEVEL),
      kind: "assigned_level",
      locked: true,
    });
  }

  for (const s of synced.beforeScores) pushCustom(s);

  return out;
}

export function isReportFormatValid(config: ReportFormatConfig, rubric: RubricConfig): boolean {
  const expanded = expandReportSections(rubric, config);
  if (rubric.type === "ponderaciones") {
    return expanded.some((s) => s.kind === "subdimension_eval");
  }
  return expanded.some((s) => s.kind === "assigned_level");
}

export function findCustomSectionByTitlePattern(
  config: ReportFormatConfig,
  pattern: RegExp
): ReportCustomSection | undefined {
  return [...config.preamble, ...config.beforeScores].find((s) => pattern.test(s.title));
}

export function getSynthesisMaxChars(
  config: ReportFormatConfig,
  rubric: RubricConfig
): number | null {
  const syn = findCustomSectionByTitlePattern(config, /síntesis|sintesis/i);
  if (syn) return syn.maxChars;
  const expanded = expandReportSections(rubric, config);
  const fromExpanded = expanded.find((s) => /síntesis|sintesis/i.test(s.title));
  return fromExpanded?.maxChars ?? null;
}

export function getProjectSummaryMaxChars(config: ReportFormatConfig): number | null {
  const sec = findCustomSectionByTitlePattern(config, /resumen.*proyecto|proyecto.*resumen/i);
  return sec?.maxChars ?? null;
}

export function getSubdimensionEvalInstructions(
  config: ReportFormatConfig,
  rubric: RubricConfig
): string {
  const synced = syncReportFormatWithRubric(config, rubric);
  return resolveSectionInstruction(synced, "subdimension_eval");
}

export function getDimensionOverviewInstructions(
  config: ReportFormatConfig,
  rubric: RubricConfig
): string {
  const synced = syncReportFormatWithRubric(config, rubric);
  return resolveSectionInstruction(synced, "dimension_overview");
}

export type SubdimensionFieldLimits = {
  analysis: number;
  justification: number;
  improvements: number;
};

export function getSubdimensionFieldLimits(
  config: ReportFormatConfig,
  rubric: RubricConfig,
  dimensionId: string,
  subdimensionId: string
): SubdimensionFieldLimits {
  const expanded = expandReportSections(rubric, config);
  const sec = expanded.find(
    (s) =>
      s.kind === "subdimension_eval" &&
      s.dimensionId === dimensionId &&
      s.subdimensionId === subdimensionId
  );
  if (!sec) return { analysis: 400, justification: 400, improvements: 400 };
  const third = Math.max(80, Math.floor(sec.maxChars / 3));
  const minThird = Math.max(50, Math.floor(sec.minChars / 3));
  return { analysis: third, justification: third, improvements: third };
}

export function getDimensionOverviewLimits(
  config: ReportFormatConfig,
  rubric: RubricConfig,
  dimensionId: string
): { minChars: number; maxChars: number } {
  const expanded = expandReportSections(rubric, config);
  const sec = expanded.find(
    (s) => s.kind === "dimension_overview" && s.dimensionId === dimensionId
  );
  return sec
    ? { minChars: sec.minChars, maxChars: sec.maxChars }
    : { ...DEFAULT_DIM_OVERVIEW };
}

/** @deprecated Use getDimensionOverviewLimits */
export function getDimensionOverviewMaxChars(
  config: ReportFormatConfig,
  rubric: RubricConfig,
  dimensionId: string
): number {
  return getDimensionOverviewLimits(config, rubric, dimensionId).maxChars;
}

export function parseReportFormatFromLegacyText(
  text: string,
  rubric?: RubricConfig
): ReportFormatConfig | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const limits = parseReportFormatLimits(trimmed);
  const preamble: ReportCustomSection[] = [];
  if (limits.summary > 0) {
    preamble.push(
      customSection({
        title: "Resumen del proyecto",
        description: "Síntesis breve del proyecto evaluado.",
        minChars: Math.floor(limits.summary * 0.9),
        maxChars: limits.summary,
      })
    );
  }

  const sectionLimits: Record<string, { minChars: number; maxChars: number }> = {};
  const beforeScores: ReportCustomSection[] = [];

  if (limits.synthesis > 0) {
    beforeScores.push(
      customSection({
        title: "Síntesis final",
        description: "Conclusión global de la evaluación.",
        minChars: Math.floor(limits.synthesis * 0.9),
        maxChars: limits.synthesis,
      })
    );
  }

  if (rubric?.type === "ponderaciones") {
    for (const dim of rubric.dimensions) {
      const dimLimit = limits.dimensions.find(
        (d) => d.name.toLowerCase() === dim.name.toLowerCase()
      );
      const overviewMax = dimLimit?.overview ?? DEFAULT_DIM_OVERVIEW.maxChars;
      sectionLimits[dimensionOverviewId(dim.id)] = clampLimits(
        Math.floor(overviewMax * 0.9),
        overviewMax
      );
      for (const sub of dim.subdimensions) {
        const subLimit = dimLimit?.subdimensions.find((s) =>
          s.name.toLowerCase().includes(sub.name.toLowerCase())
        );
        const fl = subLimit?.limits;
        const total = fl ? fl.analysis + fl.justification + fl.improvements : DEFAULT_SUB_EVAL.maxChars;
        sectionLimits[subdimensionEvalId(sub.id)] = clampLimits(
          Math.floor(total * 0.9),
          total
        );
      }
    }
    const merged = normalizeReportFormatPartial({
      preamble,
      beforeScores,
      sectionLimits,
    });
    return syncReportFormatWithRubric(merged, rubric);
  }

  const merged = normalizeReportFormatPartial({
    preamble,
    beforeScores,
    sectionLimits: { [ASSIGNED_LEVEL_ID]: { ...DEFAULT_ASSIGNED_LEVEL } },
  });
  return rubric ? syncReportFormatWithRubric(merged, rubric) : merged;
}

export function buildFormatSystemPrompt(
  config: ReportFormatConfig,
  rubric: RubricConfig
): string {
  const sections = expandReportSections(rubric, config);
  const sectionLines = sections.map((s, i) => {
    const synthesisNote =
      s.kind === "dimension_overview"
        ? "\n   IMPORTANTE: Esta sección es un RESUMEN MACRO redactado (no un simple rótulo). Debe ser un texto de síntesis propio ANTES de las subdimensiones de esta dimensión. Sintetiza ÚNICAMENTE las evaluaciones de subdimensiones de esta dimensión en el borrador. No re-evalúes ni asignes notas."
        : "";
    const preambleNote =
      s.kind === "custom" && /resumen.*proyecto|proyecto.*resumen/i.test(s.title)
        ? "\n   Origen: redacta a partir de los ELEMENTOS DEL PROYECTO en el mensaje usuario (no copies el borrador de evaluación)."
        : "";
    const synthesisFinalNote =
      s.kind === "custom" && /síntesis|sintesis/i.test(s.title)
        ? "\n   Origen: conclusión global sintetizando todas las dimensiones y subdimensiones del borrador."
        : "";
    const notaNote =
      s.kind === "subdimension_eval"
        ? "\n   Conserva el orden del borrador: Análisis → Nota → Justificación → sugerencias de mejora. Una sola línea «Nota: N», sin duplicar en negrita."
        : "";
    return `${i + 1}. **${s.title}**
   Descripción: ${s.description}
   Longitud: entre ${s.minChars} y ${s.maxChars} caracteres.${synthesisNote}${preambleNote}${synthesisFinalNote}${notaNote}`;
  });

  const scoresNote =
    rubric.type === "ponderaciones"
      ? "\n- NO redactes notas ni índice final; al cierre se insertará automáticamente el bloque «Notas e índice» con ponderaciones de la rúbrica (§4) e índice calculado."
      : "";

  return `Eres un editor de informes de evaluación. Recibirás un borrador con evaluaciones por subdimensión (sin resúmenes macro pre-redactados).
Tu tarea es redactar el informe final siguiendo EXACTAMENTE estas secciones (en este orden numerado):

${sectionLines.join("\n\n")}

REGLAS:
- Genera TODAS las secciones numeradas; no omitas ninguna ni cambies el orden.
- Cada sección debe respetar su longitud mínima y máxima de caracteres.
- Usa encabezados markdown (## para secciones principales, ### para subdimensiones) con los títulos indicados.
- «Dimensión: …» es siempre un bloque de texto de resumen macro; nunca uses ese encabezado solo como separador antes de subdimensiones.
- No añadas secciones extra, separadores «---» ni bloques fuera de la estructura.
- No incluyas anotaciones de límite de caracteres en el texto final.
- Mantén el tono profesional y objetivo.${scoresNote}

El borrador de evaluación y los elementos del proyecto se enviarán en el siguiente mensaje.`;
}

export type FormatUserPromptOptions = {
  projectElementsTable?: { element: string; content: string }[];
  reportFormat?: ReportFormatConfig;
  rubric?: RubricConfig;
};

/** Texto de elementos extraídos del proyecto para el resumen §6. */
export function formatProjectElementsBlock(
  table: { element: string; content: string }[]
): string {
  return table
    .filter((r) => r.content?.trim())
    .map((r) => `**${r.element}**\n${r.content.trim()}`)
    .join("\n\n");
}

/** Versión acotada para prompts LLM (evita pegar el proyecto completo en la salida). */
export function condenseProjectElementsForPrompt(
  table: { element: string; content: string }[],
  options?: { maxPerElement?: number; maxTotal?: number }
): string {
  const maxPer = options?.maxPerElement ?? 450;
  const maxTotal = options?.maxTotal ?? 9000;
  let total = 0;
  const lines: string[] = [];
  for (const row of table) {
    const content = row.content?.trim();
    if (!content) continue;
    const excerpt =
      content.length > maxPer ? `${content.slice(0, maxPer).trimEnd()}…` : content;
    const line = `- ${row.element}: ${excerpt}`;
    if (total + line.length > maxTotal) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

export function buildFormatUserPrompt(
  rawEvaluation: string,
  options?: FormatUserPromptOptions
): string {
  const lines: string[] = [
    "Reorganiza el contenido según la estructura del sistema.",
    "- «Resumen del proyecto»: redacta usando ELEMENTOS DEL PROYECTO (si se incluyen abajo).",
    "- Cada «Dimensión: …»: resumen macro redactado ANTES de las subdimensiones de esa dimensión.",
    "- Cada subdimensión: conserva Análisis → Nota → Justificación → sugerencias de mejora.",
    "- «Síntesis final»: conclusión global de toda la evaluación.",
    "Ajusta cada sección a su longitud objetivo. Responde solo con el informe formateado.",
  ];

  if (options?.reportFormat && options?.rubric) {
    const sections = expandReportSections(options.rubric, options.reportFormat);
    lines.push(
      "",
      "ORDEN OBLIGATORIO DE SECCIONES:",
      sections.map((s, i) => `${i + 1}. ${s.title}`).join("\n")
    );
  }

  const table = options?.projectElementsTable ?? [];
  const projectBlock = formatProjectElementsBlock(table);
  if (projectBlock) {
    lines.push("", "ELEMENTOS DEL PROYECTO (fuente para Resumen del proyecto):", projectBlock);
  }

  lines.push("", "BORRADOR DE EVALUACIÓN POR SUBDIMENSIÓN:", rawEvaluation);
  return lines.join("\n");
}

/** Títulos de sección §6 ausentes en el informe formateado (detección por encabezado). */
export function findMissingReportSectionTitles(
  formatted: string,
  config: ReportFormatConfig,
  rubric: RubricConfig
): string[] {
  const sections = expandReportSections(rubric, config);
  const missing: string[] = [];
  for (const section of sections) {
    const title = section.title.trim();
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?${escaped}\\b`, "i");
    if (!re.test(formatted)) missing.push(title);
  }
  return missing;
}

/** Estima tokens de salida para el paso de formateo según límites §6 (una sola llamada). */
export function estimateFormatReportMaxTokens(
  config: ReportFormatConfig,
  rubric: RubricConfig
): number {
  const sections = expandReportSections(rubric, config);
  const totalMaxChars = sections.reduce((sum, s) => sum + s.maxChars, 0);
  const estimated = Math.ceil(totalMaxChars / 2.5) * 1.25 + 512;
  return Math.min(32768, Math.max(2048, Math.round(estimated)));
}

export function compileReportFormatToLegacyText(
  config: ReportFormatConfig,
  rubric: RubricConfig
): string {
  return expandReportSections(rubric, config)
    .map((s) => `${s.title} (${s.minChars}-${s.maxChars} caracteres): ${s.description}`)
    .join("\n");
}

/** Metadatos de filas obligatorias de la rúbrica para la UI. */
export type RubricFormatRow =
  | {
      id: string;
      kind: "dimension_overview";
      dimensionId: string;
      label: string;
    }
  | {
      id: string;
      kind: "subdimension_eval";
      dimensionId: string;
      subdimensionId: string;
      label: string;
      dimensionName: string;
    }
  | { id: string; kind: "assigned_level"; label: string };

export function listRubricFormatRows(rubric: RubricConfig): RubricFormatRow[] {
  if (rubric.type === "niveles") {
    return [{ id: ASSIGNED_LEVEL_ID, kind: "assigned_level", label: "Nivel asignado" }];
  }
  const rows: RubricFormatRow[] = [];
  for (const dim of rubric.dimensions) {
    rows.push({
      id: dimensionOverviewId(dim.id),
      kind: "dimension_overview",
      dimensionId: dim.id,
      label: `Dimensión: ${dim.name}`,
    });
    for (const sub of dim.subdimensions) {
      rows.push({
        id: subdimensionEvalId(sub.id),
        kind: "subdimension_eval",
        dimensionId: dim.id,
        subdimensionId: sub.id,
        label: sub.name,
        dimensionName: dim.name,
      });
    }
  }
  return rows;
}
