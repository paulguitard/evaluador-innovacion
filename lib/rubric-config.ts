import {
  parseRubricDimensions,
  parseRubricSubdimensions,
  type RubricDimension,
} from "@/lib/rubric-dimensions";
import {
  parseSubdimensionWeight,
  subdimensionScoreKey,
  type RubricScoreSchemaEntry,
} from "@/lib/evaluation-scores";

export type RubricType = "ponderaciones" | "niveles";

export type RubricScoreDescription = {
  value: number;
  description: string;
};

export type RubricSubdimensionConfig = {
  id: string;
  name: string;
  weightPercent: number;
  scores: RubricScoreDescription[];
};

export type RubricDimensionConfig = {
  id: string;
  name: string;
  subdimensions: RubricSubdimensionConfig[];
};

export type RubricConfigPonderaciones = {
  type: "ponderaciones";
  scoreScale: { min: number; max: number };
  dimensions: RubricDimensionConfig[];
};

export type RubricLevelConfig = {
  id: string;
  level: number;
  title: string;
  description: string;
};

export type RubricVariableLevelConfig = {
  level: number;
  title: string;
  description: string;
};

export type RubricVariableConfig = {
  id: string;
  name: string;
  levels: RubricVariableLevelConfig[];
};

export type RubricConfigNiveles = {
  type: "niveles";
  levels: RubricLevelConfig[];
  variables: RubricVariableConfig[];
};

export type RubricConfig = RubricConfigPonderaciones | RubricConfigNiveles;

export function newRubricId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampScale(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function buildScoresForScale(
  min: number,
  max: number,
  existing?: RubricScoreDescription[]
): RubricScoreDescription[] {
  const byValue = new Map((existing ?? []).map((s) => [s.value, s.description]));
  const scores: RubricScoreDescription[] = [];
  for (let v = min; v <= max; v++) {
    scores.push({
      value: v,
      description: byValue.get(v)?.trim() || `Nota ${v}: (definir criterio)`,
    });
  }
  return scores;
}

export function defaultRubricConfigPonderaciones(): RubricConfigPonderaciones {
  const scale = { min: 1, max: 4 };
  const scores = buildScoresForScale(scale.min, scale.max);
  return {
    type: "ponderaciones",
    scoreScale: scale,
    dimensions: [
      {
        id: newRubricId(),
        name: "Novedad",
        subdimensions: [
          {
            id: newRubricId(),
            name: "Grado de Originalidad de la Idea",
            weightPercent: 25,
            scores: [...scores],
          },
          {
            id: newRubricId(),
            name: "Estado del arte",
            weightPercent: 15,
            scores: [...scores],
          },
        ],
      },
      {
        id: newRubricId(),
        name: "Potencial de impacto",
        subdimensions: [
          {
            id: newRubricId(),
            name: "Contribución Social, Ambiental o Productivo",
            weightPercent: 20,
            scores: [...scores],
          },
        ],
      },
      {
        id: newRubricId(),
        name: "Escalabilidad",
        subdimensions: [
          {
            id: newRubricId(),
            name: "Potencial de expansión",
            weightPercent: 40,
            scores: [...scores],
          },
        ],
      },
    ],
  };
}

export function defaultRubricConfigNiveles(): RubricConfigNiveles {
  const levels: RubricLevelConfig[] = [];
  for (let i = 0; i < 9; i++) {
    levels.push({
      id: newRubricId(),
      level: i,
      title: `Nivel ${i}`,
      description: `Criterio para nivel ${i} (definir).`,
    });
  }
  return { type: "niveles", levels, variables: [] };
}

function inferRubricTypeFromName(typeName?: string): RubricType {
  const n = (typeName ?? "").trim().toUpperCase();
  if (n.includes("TRL") || n.includes("NIVEL")) return "niveles";
  return "ponderaciones";
}

function mergePonderaciones(
  raw: Partial<RubricConfigPonderaciones> | null | undefined
): RubricConfigPonderaciones {
  const base = defaultRubricConfigPonderaciones();
  if (!raw || raw.type !== "ponderaciones") return base;

  const min = clampScale(Number(raw.scoreScale?.min ?? base.scoreScale.min), 1, 10);
  const max = clampScale(Number(raw.scoreScale?.max ?? base.scoreScale.max), min, 10);

  const dimensions: RubricDimensionConfig[] = Array.isArray(raw.dimensions)
    ? raw.dimensions
        .filter((d) => d && typeof d.name === "string" && d.name.trim())
        .map((d) => ({
          id: typeof d.id === "string" && d.id ? d.id : newRubricId(),
          name: d.name.trim(),
          subdimensions: Array.isArray(d.subdimensions)
            ? d.subdimensions
                .filter((s) => s && typeof s.name === "string" && s.name.trim())
                .map((s) => ({
                  id: typeof s.id === "string" && s.id ? s.id : newRubricId(),
                  name: s.name.trim(),
                  weightPercent: Math.max(0, Number(s.weightPercent) || 0),
                  scores: buildScoresForScale(min, max, s.scores),
                }))
            : [],
        }))
    : base.dimensions;

  return {
    type: "ponderaciones",
    scoreScale: { min, max },
    dimensions: dimensions.length > 0 ? dimensions : base.dimensions,
  };
}

function mergeVariableLevels(
  mainLevels: RubricLevelConfig[],
  rawLevels: RubricVariableLevelConfig[] | undefined
): RubricVariableLevelConfig[] {
  const byLevel = new Map(
    (rawLevels ?? [])
      .filter((l) => l && Number.isFinite(Number(l.level)))
      .map((l) => [
        Number(l.level),
        {
          level: Number(l.level),
          title: typeof l.title === "string" ? l.title.trim() : "",
          description: typeof l.description === "string" ? l.description : "",
        },
      ])
  );
  return mainLevels.map((main) => {
    const prev = byLevel.get(main.level);
    return {
      level: main.level,
      title: prev?.title || main.title,
      description: prev?.description ?? "",
    };
  });
}

function mergeNiveles(raw: Partial<RubricConfigNiveles> | null | undefined): RubricConfigNiveles {
  const base = defaultRubricConfigNiveles();
  if (!raw || raw.type !== "niveles") return base;

  const levels = Array.isArray(raw.levels)
    ? raw.levels
        .filter((l) => l && typeof l.title === "string")
        .map((l) => ({
          id: typeof l.id === "string" && l.id ? l.id : newRubricId(),
          level: Number.isFinite(Number(l.level)) ? Number(l.level) : 0,
          title: l.title.trim(),
          description: typeof l.description === "string" ? l.description : "",
        }))
        .sort((a, b) => a.level - b.level)
    : base.levels;

  const mergedLevels = levels.length > 0 ? levels : base.levels;

  const variables = Array.isArray(raw.variables)
    ? raw.variables
        .filter((v) => v && typeof v.name === "string" && v.name.trim())
        .map((v) => ({
          id: typeof v.id === "string" && v.id ? v.id : newRubricId(),
          name: v.name.trim(),
          levels: mergeVariableLevels(mergedLevels, v.levels),
        }))
    : [];

  return { type: "niveles", levels: mergedLevels, variables };
}

export function mergeRubricConfig(
  raw: unknown,
  typeName?: string
): RubricConfig {
  if (!raw || typeof raw !== "object") {
    return inferRubricTypeFromName(typeName) === "niveles"
      ? defaultRubricConfigNiveles()
      : defaultRubricConfigPonderaciones();
  }
  const o = raw as { type?: string };
  if (o.type === "niveles") return mergeNiveles(raw as RubricConfigNiveles);
  if (o.type === "ponderaciones") return mergePonderaciones(raw as RubricConfigPonderaciones);
  return inferRubricTypeFromName(typeName) === "niveles"
    ? defaultRubricConfigNiveles()
    : defaultRubricConfigPonderaciones();
}

export function totalWeightPercent(config: RubricConfigPonderaciones): number {
  let sum = 0;
  for (const d of config.dimensions) {
    for (const s of d.subdimensions) sum += s.weightPercent;
  }
  return Math.round(sum * 100) / 100;
}

export function isRubricConfigValid(config: RubricConfig): boolean {
  if (config.type === "niveles") {
    if (config.levels.length === 0) return false;
    if (config.variables.length === 0) return true;
    return config.variables.every(
      (v) => v.name.trim().length > 0 && v.levels.length === config.levels.length
    );
  }
  return config.dimensions.length > 0 && totalWeightPercent(config) === 100;
}

function parseScoresFromSubContent(
  content: string,
  min: number,
  max: number
): RubricScoreDescription[] {
  const scores: RubricScoreDescription[] = [];
  for (let v = min; v <= max; v++) {
    const re = new RegExp(`Nota\\s*${v}\\s*[:\\-–—]\\s*([^\\n]+)`, "i");
    const m = re.exec(content);
    scores.push({
      value: v,
      description: m?.[1]?.trim() || `Nota ${v}`,
    });
  }
  if (scores.length === 0) return buildScoresForScale(min, max);
  return scores;
}

/** Migra texto legacy de rubric_prompt a config estructurada. */
export function parseRubricFromLegacyText(text: string): RubricConfigPonderaciones | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const scale = { min: 1, max: 4 };
  const dims = parseRubricDimensions(trimmed);
  if (dims.length === 0) return null;

  const dimensions: RubricDimensionConfig[] = dims.map((dim) => {
    const subs = parseRubricSubdimensions(dim.content);
    return {
      id: newRubricId(),
      name: dim.name,
      subdimensions: subs.map((sub) => ({
        id: newRubricId(),
        name: sub.name,
        weightPercent: parseSubdimensionWeight(sub.content) ?? 0,
        scores: parseScoresFromSubContent(sub.content, scale.min, scale.max),
      })),
    };
  });

  return mergePonderaciones({ type: "ponderaciones", scoreScale: scale, dimensions });
}

export function compileRubricToLegacyText(config: RubricConfig): string {
  if (config.type === "niveles") {
    const main = config.levels
      .map((l) => `Nivel ${l.level}: ${l.title}\n${l.description}`)
      .join("\n\n");
    if (config.variables.length === 0) return main;
    const vars = config.variables
      .map((v) => {
        const lines = [`----------Variable ${v.name}:-------------`];
        for (const lvl of v.levels) {
          lines.push(`Nivel ${lvl.level}: ${lvl.title}`, lvl.description);
        }
        return lines.join("\n");
      })
      .join("\n\n");
    return `${main}\n\n${vars}`;
  }

  const parts: string[] = [];
  for (const dim of config.dimensions) {
    parts.push(`----------Dimensión ${dim.name}:-------------`);
    for (const sub of dim.subdimensions) {
      parts.push(`Subdimensión "${sub.name}"`);
      parts.push(`- Ponderación (${sub.weightPercent}%)`);
      for (const s of sub.scores) {
        parts.push(`- Nota ${s.value}: ${s.description}`);
      }
      parts.push("");
    }
  }
  return parts.join("\n").trim();
}

export function buildRubricScoreSchemaFromConfig(
  config: RubricConfig
): RubricScoreSchemaEntry[] {
  if (config.type !== "ponderaciones") return [];
  const entries: RubricScoreSchemaEntry[] = [];
  for (const dim of config.dimensions) {
    for (const sub of dim.subdimensions) {
      entries.push({
        dimension: dim.name,
        name: sub.name,
        weight: sub.weightPercent > 0 ? sub.weightPercent : null,
        key: subdimensionScoreKey(dim.name, sub.name),
      });
    }
  }
  return entries;
}

export function getRubricDimensionsForEval(
  config: RubricConfig
): RubricDimension[] {
  if (config.type !== "ponderaciones") return [];
  return config.dimensions.map((dim) => ({
    name: dim.name,
    content: dim.subdimensions
      .map((sub) => {
        const lines = [
          `Subdimensión "${sub.name}"`,
          `- Ponderación (${sub.weightPercent}%)`,
          ...sub.scores.map((s) => `- Nota ${s.value}: ${s.description}`),
        ];
        return lines.join("\n");
      })
      .join("\n\n"),
  }));
}

export function findSubdimensionInConfig(
  config: RubricConfigPonderaciones,
  dimensionId: string,
  subdimensionId: string
): { dimension: RubricDimensionConfig; subdimension: RubricSubdimensionConfig } | null {
  const dim = config.dimensions.find((d) => d.id === dimensionId);
  if (!dim) return null;
  const sub = dim.subdimensions.find((s) => s.id === subdimensionId);
  if (!sub) return null;
  return { dimension: dim, subdimension: sub };
}

export function findSubdimensionByName(
  config: RubricConfigPonderaciones,
  dimensionName: string,
  subdimensionName: string
): { dimension: RubricDimensionConfig; subdimension: RubricSubdimensionConfig } | null {
  const dim = config.dimensions.find(
    (d) => d.name.toLowerCase() === dimensionName.toLowerCase()
  );
  if (!dim) return null;
  const sub = dim.subdimensions.find((s) =>
    s.name.toLowerCase().includes(subdimensionName.toLowerCase())
  );
  if (!sub) return null;
  return { dimension: dim, subdimension: sub };
}

export function subdimensionEvalContent(
  dim: RubricDimensionConfig,
  sub: RubricSubdimensionConfig
): string {
  return [
    `Subdimensión "${sub.name}"`,
    `- Ponderación (${sub.weightPercent}%)`,
    ...sub.scores.map((s) => `- Nota ${s.value}: ${s.description}`),
  ].join("\n");
}
