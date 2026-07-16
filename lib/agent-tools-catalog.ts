/** Metadatos compartidos del catálogo de herramientas del agente (cliente y servidor). */

export type AgentToolSource = "código" | "configuración";

export type AgentToolEntry = {
  id: string;
  name: string;
  title: string;
  description: string;
  /** Esquema JSON de parámetros expuesto al LLM. */
  parametersSchema: string;
  source: AgentToolSource;
  /** Dónde se invoca la herramienta en la aplicación. */
  usedIn: string;
  /** Archivo principal de implementación. */
  implementedIn: string;
  /** Ajustes relacionados en la UI, si aplica. */
  configurableIn?: string;
};

export type AgentToolCategory = {
  id: string;
  title: string;
  description: string;
  tools: AgentToolEntry[];
};

export type AgentToolsCatalogResponse = {
  generatedAt: string;
  categories: AgentToolCategory[];
};

export function toolEntry(
  id: string,
  name: string,
  title: string,
  description: string,
  parametersSchema: string,
  source: AgentToolSource,
  usedIn: string,
  implementedIn: string,
  configurableIn?: string
): AgentToolEntry {
  return {
    id,
    name,
    title,
    description,
    parametersSchema,
    source,
    usedIn,
    implementedIn,
    configurableIn,
  };
}
