/** Tipos y constantes LLM compartidos (sin fs — seguro para cliente). */

export type LlmUseCase =
  | "chat"
  | "router"
  | "agent"
  | "evaluate"
  | "extract"
  | "vision"
  | "embeddings";

export const LLM_USE_CASES: LlmUseCase[] = [
  "chat",
  "router",
  "agent",
  "evaluate",
  "extract",
  "vision",
  "embeddings",
];

export const LLM_USE_CASE_LABELS: Record<LlmUseCase, string> = {
  chat: "Chat (respuestas al usuario)",
  router: "Router de contexto (planificación)",
  agent: "Agente con herramientas",
  evaluate: "Evaluación / informe",
  extract: "Extracción de elementos (texto)",
  vision: "Extracción con visión (imágenes)",
  embeddings: "Embeddings RAG",
};

export type LlmUseCaseParams = {
  temperature: number;
  max_tokens: number;
};

export const DEFAULT_LLM_PARAMS: Record<LlmUseCase, LlmUseCaseParams> = {
  chat: { temperature: 0.3, max_tokens: 8192 },
  router: { temperature: 0.1, max_tokens: 900 },
  agent: { temperature: 0.2, max_tokens: 1024 },
  evaluate: { temperature: 0.3, max_tokens: 8192 },
  extract: { temperature: 0.1, max_tokens: 4096 },
  vision: { temperature: 0.2, max_tokens: 2048 },
  embeddings: { temperature: 0, max_tokens: 0 },
};

export function emptyLlmModels(): Record<LlmUseCase, string> {
  return {
    chat: "",
    router: "",
    agent: "",
    evaluate: "",
    extract: "",
    vision: "",
    embeddings: "",
  };
}

export function emptyLlmParams(): Record<LlmUseCase, LlmUseCaseParams> {
  return { ...DEFAULT_LLM_PARAMS };
}

export function isLlmModelsComplete(models: Record<LlmUseCase, string>): boolean {
  return LLM_USE_CASES.every((useCase) => !!models[useCase]?.trim());
}

export function mergeLlmParams(
  raw: Partial<Record<LlmUseCase, Partial<LlmUseCaseParams>>> | null | undefined
): Record<LlmUseCase, LlmUseCaseParams> {
  const out = emptyLlmParams();
  if (!raw) return out;
  for (const useCase of LLM_USE_CASES) {
    const p = raw[useCase];
    if (!p) continue;
    if (typeof p.temperature === "number" && Number.isFinite(p.temperature)) {
      out[useCase].temperature = Math.min(2, Math.max(0, p.temperature));
    }
    if (typeof p.max_tokens === "number" && Number.isFinite(p.max_tokens)) {
      out[useCase].max_tokens = Math.min(128_000, Math.max(0, Math.round(p.max_tokens)));
    }
  }
  return out;
}

export type LlmConfigPublic = {
  models: Record<LlmUseCase, string>;
  params: Record<LlmUseCase, LlmUseCaseParams>;
  hasOpenRouterApiKey: boolean;
  modelsComplete: boolean;
};
