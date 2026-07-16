import { NextResponse } from "next/server";
import { buildImetFlowPromptChains } from "@/lib/eval-flow/imet-prompt-chains-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const evaluationTypeId = Number(id);
    if (!Number.isFinite(evaluationTypeId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }
    const chains = await buildImetFlowPromptChains(evaluationTypeId);
    if (!chains) {
      return NextResponse.json({ error: "Solo disponible para tipos IMET" }, { status: 404 });
    }
    return NextResponse.json(chains);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al cargar cadenas de prompts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
