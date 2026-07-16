import { NextResponse } from "next/server";
import { buildAgentToolsCatalog } from "@/lib/agent-tools-server";

export async function GET() {
  try {
    const catalog = await buildAgentToolsCatalog();
    return NextResponse.json(catalog);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al cargar herramientas del agente";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
