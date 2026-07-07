import { NextResponse } from "next/server";
import { getEvaluationTypeById, updateEvaluationType, deleteEvaluationType } from "@/lib/db";
import { isValidEvalTypeDeletePassword } from "@/lib/eval-type-delete-password";

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
    const name = typeof body?.name === "string" ? body.name.trim() : undefined;
    if (name === undefined) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    await updateEvaluationType(id, name);
    return NextResponse.json({ id, name });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    if (!isValidEvalTypeDeletePassword(body?.password)) {
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 403 });
    }
    await deleteEvaluationType(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
