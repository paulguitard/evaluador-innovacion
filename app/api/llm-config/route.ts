import { NextResponse } from "next/server";
import {
  getLlmConfigPublic,
  loadLlmModels,
  loadLlmParams,
  saveLlmModelsConfig,
  saveLlmParamsConfig,
} from "@/lib/llm-config-server";
import {
  isLlmModelsComplete,
  LLM_USE_CASES,
  mergeLlmParams,
  type LlmUseCase,
  type LlmUseCaseParams,
} from "@/lib/llm-config-types";

export async function GET() {
  try {
    return NextResponse.json(await getLlmConfigPublic());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const current = await loadLlmModels();
    const currentParams = await loadLlmParams();

    const models = { ...current };
    if (body?.models && typeof body.models === "object") {
      for (const useCase of LLM_USE_CASES) {
        const val = (body.models as Record<string, unknown>)[useCase];
        if (typeof val === "string") {
          models[useCase] = val.trim();
        }
      }
    }

    const params = mergeLlmParams(currentParams);
    if (body?.params && typeof body.params === "object") {
      for (const useCase of LLM_USE_CASES) {
        const raw = (body.params as Record<string, unknown>)[useCase];
        if (!raw || typeof raw !== "object") continue;
        const p = raw as Partial<LlmUseCaseParams>;
        if (typeof p.temperature === "number") params[useCase].temperature = p.temperature;
        if (typeof p.max_tokens === "number") params[useCase].max_tokens = p.max_tokens;
      }
    }

    if (!isLlmModelsComplete(models)) {
      return NextResponse.json(
        { error: "Debe configurar un modelo para cada función." },
        { status: 400 }
      );
    }

    await saveLlmModelsConfig(models);
    await saveLlmParamsConfig(params);
    return NextResponse.json({ ok: true, ...(await getLlmConfigPublic()) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
