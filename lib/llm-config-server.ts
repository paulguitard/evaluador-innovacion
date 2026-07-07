import "server-only";

import { getLlmModels, getLlmParams, saveLlmModels, saveLlmParams } from "@/lib/db";
import {
  emptyLlmModels,
  emptyLlmParams,
  isLlmModelsComplete,
  LLM_USE_CASE_LABELS,
  LLM_USE_CASES,
  mergeLlmParams,
  type LlmConfigPublic,
  type LlmUseCase,
  type LlmUseCaseParams,
} from "@/lib/llm-config-types";

function normalizeModels(raw: Record<string, unknown> | null | undefined): Record<LlmUseCase, string> {
  const models = emptyLlmModels();
  if (!raw) return models;
  for (const useCase of LLM_USE_CASES) {
    const val = raw[useCase];
    if (typeof val === "string" && val.trim()) {
      models[useCase] = val.trim();
    }
  }
  return models;
}

async function loadModelsFromStore(): Promise<Record<LlmUseCase, string>> {
  const fromDb = await getLlmModels();
  if (fromDb) return normalizeModels(fromDb);
  return emptyLlmModels();
}

async function loadParamsFromStore(): Promise<Record<LlmUseCase, LlmUseCaseParams>> {
  const fromDb = await getLlmParams();
  if (fromDb) return mergeLlmParams(fromDb as Partial<Record<LlmUseCase, Partial<LlmUseCaseParams>>>);
  return emptyLlmParams();
}

export async function loadLlmModels(): Promise<Record<LlmUseCase, string>> {
  return loadModelsFromStore();
}

export async function loadLlmParams(): Promise<Record<LlmUseCase, LlmUseCaseParams>> {
  return loadParamsFromStore();
}

export async function saveLlmModelsConfig(models: Record<LlmUseCase, string>): Promise<void> {
  const normalized = normalizeModels(models);
  if (!isLlmModelsComplete(normalized)) {
    throw new Error("Debe configurar un modelo para cada función en Configurar LLM.");
  }
  await saveLlmModels(normalized);
}

export async function saveLlmParamsConfig(params: Record<LlmUseCase, LlmUseCaseParams>): Promise<void> {
  await saveLlmParams(mergeLlmParams(params));
}

export function getApiKey(): string {
  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  if (envKey) return envKey;

  throw new Error(
    "No hay API key de OpenRouter configurada. Añádala en la variable de entorno OPENROUTER_API_KEY."
  );
}

export function hasOpenRouterApiKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

/** Siempre lee desde la base de datos (sin caché en memoria) para evitar modelos obsoletos en serverless. */
export async function resolveModelForUseCase(
  useCase: LlmUseCase,
  override?: string
): Promise<string> {
  if (override?.trim()) return override.trim();

  const models = await loadModelsFromStore();
  const model = models[useCase]?.trim();
  if (!model) {
    throw new Error(
      `No hay modelo configurado para «${LLM_USE_CASE_LABELS[useCase]}». ` +
        "Defínalo en Configurar LLM antes de usar esta función."
    );
  }
  return model;
}

export async function resolveParamsForUseCase(
  useCase: LlmUseCase,
  overrides?: { temperature?: number; max_tokens?: number }
): Promise<LlmUseCaseParams> {
  const params = await loadParamsFromStore();
  const base = params[useCase];
  return {
    temperature: overrides?.temperature ?? base.temperature,
    max_tokens: overrides?.max_tokens ?? base.max_tokens,
  };
}

export async function getLlmConfigPublic(): Promise<LlmConfigPublic> {
  const [models, params] = await Promise.all([loadLlmModels(), loadLlmParams()]);
  return {
    models,
    params,
    hasOpenRouterApiKey: hasOpenRouterApiKey(),
    modelsComplete: isLlmModelsComplete(models),
  };
}

export async function assertLlmModelsConfigured(): Promise<void> {
  const models = await loadLlmModels();
  if (isLlmModelsComplete(models)) return;
  const missing = LLM_USE_CASES.filter((useCase) => !models[useCase]?.trim()).map(
    (useCase) => LLM_USE_CASE_LABELS[useCase]
  );
  throw new Error(
    `Faltan modelos en Configurar LLM: ${missing.join(", ")}. ` +
      "Todos los campos son obligatorios; no hay modelos por defecto."
  );
}
