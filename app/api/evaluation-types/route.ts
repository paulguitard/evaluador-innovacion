import { NextResponse } from "next/server";
import { ensureFixedEvaluationTypes } from "@/lib/eval-types/ensure-fixed-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const types = await ensureFixedEvaluationTypes();
    return NextResponse.json(types);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** Los tipos IGIP/IMET son fijos; no se pueden crear desde la API. */
export async function POST() {
  return NextResponse.json(
    { error: "Los tipos de evaluación están fijos (IGIP e IMET). No se pueden crear nuevos." },
    { status: 405 }
  );
}
