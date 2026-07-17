import { NextResponse } from "next/server";
import {
  deleteEvaluationHistory,
  getEvaluationHistoryById,
  updateEvaluationHistoryProjectName,
} from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: raw } = await context.params;
    const id = parseId(raw);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }
    const row = await getEvaluationHistoryById(id);
    if (!row) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id: raw } = await context.params;
    const id = parseId(raw);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }
    const body = (await request.json()) as {
      project_name?: string;
      projectName?: string;
    };
    const projectName = (
      typeof body.project_name === "string"
        ? body.project_name
        : (body.projectName ?? "")
    ).trim();
    if (!projectName) {
      return NextResponse.json(
        { error: "projectName es obligatorio" },
        { status: 400 }
      );
    }
    const row = await updateEvaluationHistoryProjectName(id, projectName);
    if (!row) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id: raw } = await context.params;
    const id = parseId(raw);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }
    const deleted = await deleteEvaluationHistory(id);
    if (!deleted) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
