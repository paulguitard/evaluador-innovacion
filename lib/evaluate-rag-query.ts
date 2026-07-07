import {
  summarizeProjectForEvaluationFocus,
  type RubricDimension,
  type RubricSubdimension,
} from "@/lib/rubric-dimensions";

export function buildSubdimensionKnowledgeQuery(
  dimension: RubricDimension,
  subdimension: RubricSubdimension,
  projectElementsTable: { element: string; content: string }[],
  topN: number
): string {
  const projectExcerpt = summarizeProjectForEvaluationFocus(
    projectElementsTable,
    {
      name: subdimension.name,
      dimensionName: dimension.name,
      rubricContent: subdimension.content,
    },
    1200,
    topN
  );
  return [
    subdimension.name,
    dimension.name,
    subdimension.content.slice(0, 900),
    projectExcerpt,
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}
