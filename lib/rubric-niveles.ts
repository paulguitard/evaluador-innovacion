import type {
  RubricConfigNiveles,
  RubricLevelConfig,
  RubricVariableConfig,
  RubricVariableLevelConfig,
} from "@/lib/rubric-config";

export function syncVariableLevelsWithMain(
  mainLevels: RubricLevelConfig[],
  existing?: RubricVariableLevelConfig[]
): RubricVariableLevelConfig[] {
  return mainLevels.map((main, i) => {
    const prev = existing?.[i];
    return {
      level: main.level,
      title: prev?.title?.trim() || main.title,
      description: prev?.description ?? "",
    };
  });
}

export function syncAllVariableLevels(
  config: RubricConfigNiveles
): RubricConfigNiveles {
  return {
    ...config,
    variables: config.variables.map((v) => ({
      ...v,
      levels: syncVariableLevelsWithMain(config.levels, v.levels),
    })),
  };
}

export function variableEvalContent(variable: RubricVariableConfig): string {
  const lines = [`Variable "${variable.name}"`, "Criterios por nivel (esta perspectiva):"];
  for (const lvl of variable.levels) {
    lines.push(`Nivel ${lvl.level} — ${lvl.title}`, lvl.description);
  }
  return lines.join("\n");
}

export function mainLevelsRubricText(levels: RubricLevelConfig[]): string {
  return levels
    .map((l) => `Nivel ${l.level} — ${l.title}\n${l.description}`)
    .join("\n\n");
}

export function variableLevelKey(variableName: string): string {
  return `variable:${variableName.trim().toLowerCase()}`;
}

export function parseAssignedLevel(
  text: string,
  validLevels: number[]
): number | null {
  const m = /Nivel\s*:\s*(\d+)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return validLevels.includes(n) ? n : null;
}

/** Nivel global por mayoría; en empate gana el nivel más alto. */
export function computeMajorityLevel(levels: (number | null)[]): number | null {
  const valid = levels.filter((l): l is number => l != null);
  if (valid.length === 0) return null;

  const counts = new Map<number, number>();
  for (const l of valid) {
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [level, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && (best == null || level > best))
    ) {
      best = level;
      bestCount = count;
    }
  }
  return best;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractVariableSection(
  text: string,
  variableName: string
): string | null {
  const name = escapeRegex(variableName.trim());
  const patterns = [
    new RegExp(
      `(?:#{1,3}\\s*)?Variable[:\\s]*["']?${name}["']?[^\\n]*\\n([\\s\\S]*?)(?=(?:#{1,3}\\s*)?Variable[:\\s]|#{1,2}\\s*Nivel asignado|---\\s*$|$)`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

export function extractGlobalLevelSection(text: string): string | null {
  const m =
    /(?:#{1,2}\s*Nivel asignado(?:\s+global)?[^\n]*\n)([\s\S]*?)$/i.exec(text);
  if (m?.[1]?.trim()) return m[1].trim();
  const afterSep = text.split(/\n---\n/);
  if (afterSep.length > 1) {
    const tail = afterSep[afterSep.length - 1].trim();
    if (tail) return tail.replace(/^#{1,2}\s*Nivel asignado[^\n]*\n?/i, "").trim();
  }
  return null;
}

export function hasRubricVariables(
  rubric: RubricConfigNiveles
): boolean {
  return (rubric.variables?.length ?? 0) > 0;
}

export function validLevelNumbers(rubric: RubricConfigNiveles): number[] {
  return rubric.levels.map((l) => l.level);
}
