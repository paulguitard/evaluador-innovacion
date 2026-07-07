"use client";

import { useState, useEffect } from "react";
import { knowledgePathsToLabels } from "@/lib/extract-stream";
import { mergeRubricConfig, buildRubricScoreSchemaFromConfig } from "@/lib/rubric-config";
import type { RubricScoreSchemaEntry } from "@/lib/evaluation-scores";

export type ElementWithSection = {
  title: string;
  section: string;
  description: string;
};

export function useEvaluationConfig(activeTypeId: number | null, configOpen: boolean) {
  const [elementsWithSection, setElementsWithSection] = useState<ElementWithSection[]>([]);
  const [knowledgeDocNames, setKnowledgeDocNames] = useState<string[]>([]);
  const [rubricPrompt, setRubricPrompt] = useState("");
  const [scoreSchema, setScoreSchema] = useState<RubricScoreSchemaEntry[]>([]);

  useEffect(() => {
    if (!activeTypeId) {
      setElementsWithSection([]);
      setKnowledgeDocNames([]);
      setRubricPrompt("");
      setScoreSchema([]);
      return;
    }
    fetch(`/api/config/${activeTypeId}`)
      .then((r) => r.json())
      .then((data) => {
        const elements = Array.isArray(data.elements) ? data.elements : [];
        const mapped = elements
          .filter((e: unknown) => typeof e === "object" && e != null && "title" in e)
          .map((e: { title?: string; section?: string; description?: string }) => ({
            title: String((e as { title: string }).title ?? "").trim(),
            section:
              typeof (e as { section?: string }).section === "string"
                ? ((e as { section: string }).section ?? "General").trim()
                : "General",
            description:
              typeof (e as { description?: string }).description === "string"
                ? (e as { description: string }).description.trim()
                : "",
          }))
          .filter((e: { title: string }) => e.title);
        setElementsWithSection(mapped);
        const paths = Array.isArray(data.knowledge_paths) ? data.knowledge_paths : [];
        setKnowledgeDocNames(knowledgePathsToLabels(paths));
        const rubric = mergeRubricConfig(data.rubric_config);
        const schema = buildRubricScoreSchemaFromConfig(rubric);
        setRubricPrompt(
          schema.length > 0
            ? schema.map((s) => `${s.dimension} / ${s.name}`).join("\n")
            : typeof data.rubric_prompt === "string"
              ? data.rubric_prompt
              : ""
        );
        setScoreSchema(schema);
      })
      .catch(() => {
        setElementsWithSection([]);
        setKnowledgeDocNames([]);
        setRubricPrompt("");
        setScoreSchema([]);
      });
  }, [activeTypeId, configOpen]);

  return { elementsWithSection, knowledgeDocNames, rubricPrompt, scoreSchema };
}
