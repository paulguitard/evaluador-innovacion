import { chatCompletion } from "@/lib/openrouter";
import type { ElementDef } from "@/lib/excel-heuristics";

function buildSystemPrompt(element: ElementDef, structurePrompt?: string): string {
  if (structurePrompt?.trim()) {
    return `${structurePrompt.trim()}

Descripción del elemento (prioridad máxima):
${element.description}`;
  }
  return `Eres un asistente que estructura la carta Gantt / plan de actividades de proyectos.

Recibirás datos de la hoja Excel con nombres y descripciones de actividades.

REGLAS OBLIGATORIAS:
- Lista numerada (1, 2, 3…) con una actividad por bloque.
- Cada actividad incluye ÚNICAMENTE:
  • Nombre de la actividad
  • Descripción de la actividad
- NO incluyas: tareas, subtareas, responsables, fechas, duración, % avance, evidencias ni columnas extra.
- NO copies párrafos de desarrollo técnico ni texto de otras hojas.
- NO inventes actividades; solo usa los datos proporcionados.
- Omite encabezados de tabla, filas vacías y filas de subtareas ("Tareas:").
- Respeta la descripción del elemento configurada por el usuario.
- Responde ÚNICAMENTE JSON: {"content":"...","confidence":"high|medium|low"}

Descripción del elemento (prioridad máxima):
${element.description}`;
}

function parseStructureJson(raw: string): { content: string; confidence: string } {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { content: trimmed, confidence: "medium" };
  try {
    const obj = JSON.parse(jsonMatch[0]) as { content?: string; confidence?: string };
    return {
      content: typeof obj.content === "string" ? obj.content : "",
      confidence: typeof obj.confidence === "string" ? obj.confidence : "medium",
    };
  } catch {
    return { content: trimmed, confidence: "low" };
  }
}

export async function structureGanttActivitiesWithLlm(
  element: ElementDef,
  rawContext: string,
  structurePrompt?: string
): Promise<{ content: string; confidence: string }> {
  const response = await chatCompletion(
    [
      { role: "system", content: buildSystemPrompt(element, structurePrompt) },
      {
        role: "user",
        content: `Elemento: "${element.title}"

Datos de la hoja (solo nombre y descripción de cada actividad):
${rawContext}

Genera la lista según las reglas. Responde JSON.`,
      },
    ],
    { max_tokens: 4096, temperature: 0.1, useCase: "extract" }
  );

  const parsed = parseStructureJson(response?.trim() ?? "");
  return { content: parsed.content.trim(), confidence: parsed.confidence };
}
