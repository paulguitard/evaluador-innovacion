import { NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/lib/db";
import { getEvaluationTypeById } from "@/lib/db";
import { indexKnowledge } from "@/lib/rag-index";

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
    const knowledge_paths = (() => {
      try {
        const raw = JSON.parse(config.knowledge_paths || "[]");
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })();
    const elements = (() => {
      try {
        const raw = JSON.parse(config.elements ?? "[]");
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [];
      }
    })();
    return NextResponse.json({
      evaluation_type_id: config.evaluation_type_id,
      prompt: config.prompt,
      knowledge_paths,
      rubric_path: config.rubric_path || "",
      elements,
      instructions: config.instructions ?? "",
      report_format: config.report_format ?? "",
      rubric_prompt: config.rubric_prompt ?? "",
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
    const prompt = typeof body?.prompt === "string" ? body.prompt : undefined;
    const knowledge_paths = Array.isArray(body?.knowledge_paths)
      ? body.knowledge_paths.filter(
          (p: unknown) =>
            typeof p === "string" ||
            (typeof p === "object" && p != null && "name" in p && "url" in p)
        )
      : undefined;
    const rubric_path = typeof body?.rubric_path === "string" ? body.rubric_path : undefined;
    const elements = Array.isArray(body?.elements)
      ? body.elements.filter(
          (e: unknown) =>
            typeof e === "object" && e != null && "title" in e && "description" in e
        )
      : undefined;
    const instructions = typeof body?.instructions === "string" ? body.instructions : undefined;
    const report_format = typeof body?.report_format === "string" ? body.report_format : undefined;
    const rubric_prompt = typeof body?.rubric_prompt === "string" ? body.rubric_prompt : undefined;
    await updateConfig(id, {
      prompt,
      knowledge_paths,
      rubric_path,
      elements,
      instructions,
      report_format,
      rubric_prompt,
    });
    if (knowledge_paths !== undefined) {
      indexKnowledge(id).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
