import { NextResponse } from "next/server";
import { getEvaluationTypeById } from "@/lib/db";
import { indexKnowledge } from "@/lib/rag-index";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const type = await getEvaluationTypeById(id);
    if (!type) {
      return NextResponse.json({ error: "Evaluation type not found" }, { status: 404 });
    }
    await indexKnowledge(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
