import { NextResponse } from "next/server";
import { getEvaluationTypes, createEvaluationType } from "@/lib/db";

export async function GET() {
  try {
    const types = await getEvaluationTypes();
    return NextResponse.json(types);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const id = await createEvaluationType(name);
    return NextResponse.json({ id, name });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
