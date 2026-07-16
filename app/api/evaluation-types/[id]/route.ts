import { NextResponse } from "next/server";
import { getEvaluationTypeById } from "@/lib/db";
import { isFixedEvalTypeName } from "@/lib/eval-types/constants";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const row = await getEvaluationTypeById(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** Renombrar tipos fijos no está permitido. */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const row = await getEvaluationTypeById(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (isFixedEvalTypeName(row.name)) {
    return NextResponse.json(
      { error: "No se puede renombrar un tipo de evaluación fijo (IGIP/IMET)." },
      { status: 405 }
    );
  }
  return NextResponse.json(
    { error: "Los tipos de evaluación están fijos. No se puede renombrar." },
    { status: 405 }
  );
}

/** Eliminar tipos no está permitido. */
export async function DELETE() {
  return NextResponse.json(
    { error: "Los tipos de evaluación están fijos (IGIP e IMET). No se pueden eliminar." },
    { status: 405 }
  );
}
