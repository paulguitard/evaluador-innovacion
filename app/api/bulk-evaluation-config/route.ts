import { NextResponse } from "next/server";
import {
  loadBulkEvaluationConfig,
  saveBulkEvaluationConfig,
} from "@/lib/bulk-evaluation-config-server";
import { mergeBulkEvaluationConfig } from "@/lib/bulk-evaluation-config";

export async function GET() {
  try {
    const config = await loadBulkEvaluationConfig();
    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const merged = mergeBulkEvaluationConfig(body);
    await saveBulkEvaluationConfig(merged);
    return NextResponse.json(merged);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
