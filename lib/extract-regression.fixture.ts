import type { ExcelStructuredData } from "@/lib/excel-structured-extract";

/** Fragmento de bitácora IGIP (filas 1–21) para regresión de extractores. */
export function bitacoraAguaConectaFixture(): ExcelStructuredData {
  const continuityAnswer =
    "Sí, este proyecto es la continuación de la iniciativa llamada 'Aplicación móvil para la optimización de riego', la cual permitiría conocer en tiempo real el caudal de agua disponible en el tranque, información a la que solo accedía el directorio. En esta nueva fase, el proyecto da un paso más inclusivo y participativo.";
  const pertinenciaValue =
    "Pertinencia local: La iniciativa entrega información clave sobre caudal de agua y clima a todas las familias de la Comunidad de Regantes El Zaino, mejorando la gestión del riego. Pertinencia disciplinar: Permite a los estudiantes aplicar sus conocimientos en un contexto real.";
  const necesidadAnswer =
    "En la Comunidad de Regantes El Zaino, la información sobre el caudal de agua era recibida solo por el directorio, lo que limitaba la autonomía de los parceleros en la toma de decisiones. Este proyecto busca resolver esa brecha mediante un sitio web que entrega datos en tiempo real.";

  return {
    fileName: "bitacora-agua-conecta.xlsx",
    sheets: [
      {
        sheetName: "Resumen Proyecto",
        merges: [{ startRow: 1, startCol: 2, endRow: 1, endCol: 4 }],
        cells: [
          { row: 1, col: 2, value: "Agua Conecta" },
          { row: 3, col: 1, value: "Objetivo general" },
          {
            row: 3,
            col: 2,
            value:
              "Optimizar el uso del agua en la Comunidad de Regantes El Zaino mediante información en tiempo real para las familias parceleras.",
          },
          { row: 5, col: 1, value: "Objetivos específicos" },
          { row: 5, col: 2, value: "1. Desarrollar una plataforma web accesible." },
          { row: 6, col: 2, value: "2. Integrar datos de caudal y clima." },
          { row: 7, col: 2, value: "3. Capacitar a familias en el uso de la herramienta." },
          { row: 9, col: 1, value: "Sedes" },
          { row: 9, col: 2, value: "San Fernando, O'Higgins" },
          { row: 10, col: 1, value: "Escuelas" },
          { row: 10, col: 2, value: "Ingeniería en Informática" },
          {
            row: 17,
            col: 1,
            value:
              "¿El proyecto es continuidad de una fase anterior?. De ser así, ¿Cuáles son los elementos innovadores y diferenciadores en esta nueva fase?",
          },
          { row: 17, col: 2, value: continuityAnswer },
          { row: 18, col: 1, value: "Pertinencia Local y Disciplinar." },
          { row: 18, col: 2, value: pertinenciaValue },
          {
            row: 19,
            col: 1,
            value: "Necesidad, problema u oportunidad que aborda la iniciativa.",
          },
          { row: 19, col: 2, value: necesidadAnswer },
          {
            row: 21,
            col: 1,
            value: "En qué consiste la solución propuesta por la iniciativa.",
          },
          {
            row: 21,
            col: 2,
            value:
              "La solución propuesta consiste en el desarrollo de una página web. Esta nueva etapa da continuidad al proyecto anterior.",
          },
        ],
      },
    ],
  };
}

/**
 * Bitácora IGIP con título en A1:E1 y fila "ID VINCULAMOS" = "No registrada"
 * (caso real: el placeholder no debe ganar al nombre del proyecto).
 */
export function bitacoraDigitalizaTuNegocioFixture(): ExcelStructuredData {
  return {
    fileName: "Bitácora Digitaliza tu negocio.xlsx",
    sheets: [
      {
        sheetName: "Resumen Proyecto",
        merges: [
          { startRow: 1, startCol: 1, endRow: 1, endCol: 5 },
          { startRow: 2, startCol: 2, endRow: 2, endCol: 4 },
        ],
        cells: [
          { row: 1, col: 1, value: "Digitaliza tu negocio" },
          { row: 2, col: 1, value: "ID VINCULAMOS" },
          { row: 2, col: 2, value: "No registrada" },
          { row: 3, col: 1, value: "Nombre Encargado" },
          { row: 3, col: 2, value: "Jorge Guajardo Ibarra" },
          { row: 4, col: 1, value: "Sede" },
          { row: 4, col: 2, value: "San Bernardo" },
          { row: 5, col: 1, value: "OBJETIVO GENERAL:" },
          {
            row: 5,
            col: 2,
            value:
              "Desarrollar e implementar un sistema de ventas digital para el negocio del socio comunitario.",
          },
        ],
      },
    ],
  };
}

/** Valores esperados (golden) para extractores determinísticos sobre la bitácora. */
export const BITACORA_GOLDEN: Record<string, { minLength: number; mustMatch?: RegExp; mustNotMatch?: RegExp }> = {
  "Continuidad de fases anteriores": {
    minLength: 80,
    mustMatch: /^S[ií],?\s+este\s+proyecto/i,
    mustNotMatch: /¿El proyecto es continuidad/i,
  },
  "Necesidad, problema u oportunidad": {
    minLength: 40,
    mustMatch: /Comunidad de Regantes El Zaino/i,
  },
  "Pertinencia local": {
    minLength: 40,
    mustMatch: /iniciativa entrega informaci[oó]n/i,
    mustNotMatch: /Permite a los estudiantes/i,
  },
  "Nombre del proyecto": {
    minLength: 3,
    mustMatch: /Agua Conecta/i,
  },
  Sedes: {
    minLength: 2,
    mustMatch: /San Fernando/i,
  },
};
