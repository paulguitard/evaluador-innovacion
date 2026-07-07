import { NextResponse } from "next/server";

import { getConfig, updateConfig } from "@/lib/db";

import { getEvaluationTypeById } from "@/lib/db";

import { indexKnowledge } from "@/lib/rag-index";

import {

  knowledgeItemKey,

  parseKnowledgePaths,

  type KnowledgePathItem,

} from "@/lib/knowledge-config";

import { deleteRemovedBlobKnowledgeFiles } from "@/lib/blob-knowledge-cleanup";

import { mergeEvaluationTypeSettings, parseElementDefConfig } from "@/lib/evaluation-type-settings";

import { mergeRubricConfig } from "@/lib/rubric-config";

import { mergeReportFormatConfig } from "@/lib/report-format-config";

import { mergeEvaluationConfig } from "@/lib/evaluation-config";



export const maxDuration = 300;



function parseJsonField(raw: string | undefined, fallback: unknown): unknown {

  try {

    return JSON.parse(raw ?? JSON.stringify(fallback));

  } catch {

    return fallback;

  }

}



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

    if (!type) return NextResponse.json({ error: "Evaluation type not found" }, { status: 404 });

    const config = await getConfig(id);

    if (!config) return NextResponse.json({ error: "Config not found" }, { status: 404 });

    const knowledge_paths = parseKnowledgePaths(config.knowledge_paths);

    const elements = (() => {

      try {

        const raw = JSON.parse(config.elements ?? "[]");

        return Array.isArray(raw) ? raw : [];

      } catch {

        return [];

      }

    })();

    const settings = mergeEvaluationTypeSettings(

      {

        pipeline_config: parseJsonField(config.pipeline_config, {}),

        rag_config: parseJsonField(config.rag_config, {}),

        extract_config: parseJsonField(config.extract_config, {}),

      },

      type.name

    );

    const rubric_config = mergeRubricConfig(

      parseJsonField(config.rubric_config, {}),

      type.name

    );

    const report_format_config = mergeReportFormatConfig(

      parseJsonField(config.report_format_config, {}),

      rubric_config

    );

    const evaluation_config = mergeEvaluationConfig(

      {

        evaluation_config: parseJsonField(config.evaluation_config, {}),

        pipeline_config: settings.pipeline,

        report_format_config,

        rag_config: settings.rag,

      },

      type.name

    );

    return NextResponse.json({

      evaluation_type_id: config.evaluation_type_id,

      knowledge_paths,

      elements,

      report_format: config.report_format ?? "",

      rubric_prompt: config.rubric_prompt ?? "",

      rubric_config,

      report_format_config,

      evaluation_config,

      pipeline_config: settings.pipeline,

      rag_config: settings.rag,

      extract_config: settings.extract,

    });

  } catch (e) {

    return NextResponse.json({ error: String(e) }, { status: 500 });

  }

}



export async function PATCH(

  request: Request,

  { params }: { params: Promise<{ id: string }> }

) {

  try {

    const id = Number((await params).id);

    if (!Number.isInteger(id)) {

      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    }

    const body = await request.json();

    const knowledge_paths = Array.isArray(body?.knowledge_paths)

      ? body.knowledge_paths.filter(

          (p: unknown): p is KnowledgePathItem =>

            typeof p === "object" &&

            p != null &&

            typeof (p as KnowledgePathItem).name === "string" &&

            typeof (p as KnowledgePathItem).url === "string"

        )

      : undefined;

    const elements = Array.isArray(body?.elements)

      ? body.elements

          .map((e: unknown) => parseElementDefConfig(e))

          .filter((e: ReturnType<typeof parseElementDefConfig>): e is NonNullable<typeof e> => e != null)

      : undefined;

    const report_format = typeof body?.report_format === "string" ? body.report_format : undefined;

    const rubric_prompt = typeof body?.rubric_prompt === "string" ? body.rubric_prompt : undefined;

    const pipeline_config =

      body?.pipeline_config && typeof body.pipeline_config === "object"

        ? body.pipeline_config

        : undefined;

    const rag_config =

      body?.rag_config && typeof body.rag_config === "object" ? body.rag_config : undefined;

    const extract_config =

      body?.extract_config && typeof body.extract_config === "object" ? body.extract_config : undefined;

    const evaluation_config =

      body?.evaluation_config && typeof body.evaluation_config === "object"

        ? body.evaluation_config

        : undefined;



    const type = await getEvaluationTypeById(id);

    if (!type) return NextResponse.json({ error: "Evaluation type not found" }, { status: 404 });



    const rubric_config =

      body?.rubric_config && typeof body.rubric_config === "object"

        ? mergeRubricConfig(body.rubric_config, type.name)

        : undefined;

    const report_format_config =

      body?.report_format_config && typeof body.report_format_config === "object"

        ? mergeReportFormatConfig(

            body.report_format_config,

            rubric_config ?? mergeRubricConfig({}, type.name)

          )

        : undefined;



    const mergedSettings =

      pipeline_config !== undefined || rag_config !== undefined || extract_config !== undefined

        ? mergeEvaluationTypeSettings(

            { pipeline_config, rag_config, extract_config },

            type.name

          )

        : null;



    let indexResult: { chunkCount: number } | undefined;

    let indexError: string | undefined;



    const patchPayload = {

      knowledge_paths,

      elements,

      report_format,

      rubric_prompt,

      rubric_config,

      report_format_config,

      evaluation_config,

      pipeline_config: mergedSettings?.pipeline ?? pipeline_config,

      rag_config: mergedSettings?.rag ?? rag_config,

      extract_config: mergedSettings?.extract ?? extract_config,

    };



    if (knowledge_paths !== undefined) {

      const current = await getConfig(id);

      const previous = parseKnowledgePaths(current?.knowledge_paths);

      const next = knowledge_paths as KnowledgePathItem[];

      const prevKeys = new Set(previous.map(knowledgeItemKey));

      const nextKeys = new Set(next.map(knowledgeItemKey));

      const removed = previous.filter((p) => !nextKeys.has(knowledgeItemKey(p)));

      const added = next.filter((p) => !prevKeys.has(knowledgeItemKey(p)));

      await deleteRemovedBlobKnowledgeFiles(removed);



      await updateConfig(id, patchPayload);



      if (removed.length > 0 || added.length > 0 || next.length === 0) {

        try {

          indexResult = await indexKnowledge(id);

        } catch (e) {

          indexError = e instanceof Error ? e.message : String(e);

        }

      }

    } else {

      await updateConfig(id, patchPayload);

    }



    return NextResponse.json({

      ok: true,

      chunkCount: indexResult?.chunkCount,

      indexError,

    });

  } catch (e) {

    return NextResponse.json({ error: String(e) }, { status: 500 });

  }

}

