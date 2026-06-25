import type { ExcelStructuredData } from "@/lib/excel-structured-extract";

/** Fragmento de bitácora IGIP (filas 17–19) para regresión de extractores. */
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
        merges: [],
        cells: [
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
