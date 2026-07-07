import path from "path";
import { extractExcelToStructuredJson } from "@/lib/excel-structured-extract";

let cached: Awaited<ReturnType<typeof extractExcelToStructuredJson>> | null = null;

export async function imetDocuCoreFixture() {
  if (cached) return cached;
  const xlsxPath = path.join(process.cwd(), "lib/extract-fixtures/imet-sample.xlsx");
  cached = await extractExcelToStructuredJson(xlsxPath);
  return cached;
}

export const IMET_DOCUCORE_GOLDEN: Record<
  string,
  { minLength: number; mustMatch?: RegExp; mustNotMatch?: RegExp }
> = {
  "Nombre del proyecto": {
    minLength: 3,
    mustMatch: /DocuCore/i,
    mustNotMatch: /describe brevemente/i,
  },
  "Avance actual": {
    minLength: 80,
    mustMatch: /\.NET 8|React 19|prototipo/i,
  },
  "Descripción del emprendimiento": {
    minLength: 40,
    mustMatch: /DocuCore|SaaS/i,
  },
  "Origen de la idea": {
    minLength: 40,
    mustMatch: /Taller de Proyecto/i,
  },
  "Problema, necesidad u oportunidad": {
    minLength: 40,
    mustMatch: /colegios|pymes/i,
  },
  Solución: {
    minLength: 40,
    mustMatch: /DocuCore|plataforma web/i,
  },
};

export const IMET_ELEMENT_DEFS = Object.keys(IMET_DOCUCORE_GOLDEN).map((title) => ({
  title,
  description: title,
  section: title.includes("proyecto") || title.includes("Origen") || title.includes("Descripción")
    ? "General"
    : "Desarrollo Técnico",
}));
