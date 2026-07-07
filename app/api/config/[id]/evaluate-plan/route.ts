import { NextResponse } from "next/server";
import { getConfig, getEvaluationTypeById } from "@/lib/db";
import { getEvaluationConfig } from "@/lib/evaluation-config-server";
import {
  mergeRubricConfig,
  subdimensionEvalContent,
  buildRubricScoreSchemaFromConfig,
  type RubricConfigNiveles,
} from "@/lib/rubric-config";
import { CONTEXT_LIMITS, applyEvaluateRagOverrides } from "@/lib/rag-limits";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const type = await getEvaluationTypeById(id);
    const config = await getConfig(id);
    if (!type || !config) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rubric = mergeRubricConfig(JSON.parse(config.rubric_config || "{}"), type.name);
    const evaluation = await getEvaluationConfig(id);
    const ragLimits = applyEvaluateRagOverrides(
      CONTEXT_LIMITS.evaluate,
      evaluation.ragEvaluate
    );

    if (rubric.type === "niveles") {
      const rubricText = (rubric as RubricConfigNiveles).levels
        .map((l) => `Nivel ${l.level} — ${l.title}\n${l.description}`)
        .join("\n\n");

      return NextResponse.json({
        rubricType: "niveles",
        subdimensions: [
          {
            key: "nivel-global",
            dimension: "Nivel global",
            name: "Asignación de nivel",
            rubricContent: rubricText,
          },
        ],
        ragEvaluate: {
          topK: ragLimits.topK,
          maxRetrievedChars: ragLimits.maxRetrievedChars,
        },
        knowledgeReferenceLabel: evaluation.knowledgeReferenceLabel,
        projectElementsInRagQuery: evaluation.projectElementsInRagQuery,
      });
    }

    if (rubric.type !== "ponderaciones") {
      return NextResponse.json({ error: "Tipo de rúbrica no soportado" }, { status: 400 });
    }

    const schema = buildRubricScoreSchemaFromConfig(rubric);

    const subdimensions = schema.map((entry) => {
      const dim = rubric.dimensions.find((d) => d.name === entry.dimension);
      const sub = dim?.subdimensions.find((s) => s.name === entry.name);
      return {
        key: entry.key,
        dimension: entry.dimension,
        name: entry.name,
        rubricContent: dim && sub ? subdimensionEvalContent(dim, sub) : "",
      };
    });

    return NextResponse.json({
      rubricType: "ponderaciones",
      subdimensions,
      ragEvaluate: {
        topK: ragLimits.topK,
        maxRetrievedChars: ragLimits.maxRetrievedChars,
      },
      knowledgeReferenceLabel: evaluation.knowledgeReferenceLabel,
      projectElementsInRagQuery: evaluation.projectElementsInRagQuery,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
