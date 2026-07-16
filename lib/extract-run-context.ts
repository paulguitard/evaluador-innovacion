import type { ExtractConfig } from "@/lib/evaluation-type-settings";

let activeExtractConfig: ExtractConfig | undefined;

/** Contexto de extract_config activo durante un pipeline de extracción (herramientas LLM). */
export function setExtractRunContext(config: ExtractConfig | undefined): void {
  activeExtractConfig = config;
}

export function getExtractRunContext(): ExtractConfig | undefined {
  return activeExtractConfig;
}
