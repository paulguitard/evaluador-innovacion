import { NextResponse } from "next/server";
import { buildSystemPromptsCatalog } from "@/lib/system-prompts-server";

export async function GET() {
  try {
    const catalog = await buildSystemPromptsCatalog();
    return NextResponse.json(catalog);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al cargar system prompts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
