import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripIndexedCellMetadata } from "@/lib/extract-content-clean";
import { extractFormRowFromExcel } from "@/lib/form-row-extract";
import type { ExcelStructuredData } from "@/lib/excel-structured-extract";
import { allowFallbackOverwrite, isCanonicalExtraction } from "@/lib/extract-source-policy";
import {
  bitacoraAguaConectaFixture,
  BITACORA_GOLDEN,
} from "@/lib/extract-regression.fixture";
import { plainTextToStructuredData } from "@/lib/excel-structured-extract";
import { extractAllElementsHeuristic } from "@/lib/excel-heuristics";
import { detectProjectName } from "@/lib/project-name-detect";
import { extractSpecificObjectivesFromExcel } from "@/lib/objective-extract";
import { isIncompleteElement } from "@/lib/project-extract-validate";
import { tryDeterministicExtract } from "@/lib/project-extract-hybrid";
import { extractElementHeuristic } from "@/lib/excel-heuristics";
import { getIndicatorsSheetContext } from "@/lib/indicators-extract";
import { extractGanttActivitiesFromExcel, getGanttSheetContext } from "@/lib/gantt-extract";
import { isGanttActivitiesElement, sheetsForElement, isGanttSheetName } from "@/lib/sheet-element-routing";
import { mergeEvaluationTypeSettings } from "@/lib/evaluation-type-settings";
import { conenergiaTrlFixture } from "@/lib/extract-fixtures/conenergia-trl.fixture";
import { IGIP_ELEMENT_DEFS } from "@/lib/extract-fixtures/igip-elements";
import {
  IGIP_VERIFICATION_MATRIX,
  matrixCoversAllConfigElements,
  untestedMatrixRows,
} from "@/lib/extract-verification-matrix";
import { PDF_FORM_SNIPPET, DOCX_FORM_SNIPPET } from "@/lib/extract-fixtures/plain-text-snippets";
import {
  imetDocuCoreFixture,
  IMET_DOCUCORE_GOLDEN,
  IMET_ELEMENT_DEFS,
} from "@/lib/extract-fixtures/imet-docucore.fixture";
import { isQaColumnWorkbook } from "@/lib/qa-column-extract";
import { projectIndexMatches, saveProjectChunks } from "@/lib/project-vector-store";
import { saveProjectStructuredIndex } from "@/lib/project-structured-index";
import path from "path";
import fs from "fs";
import os from "os";

describe("extract-source-policy", () => {
  it("form_row es extracción canónica", () => {
    assert.equal(isCanonicalExtraction("form_row"), true);
    assert.equal(allowFallbackOverwrite("form_row", true), false);
    assert.equal(allowFallbackOverwrite("keyword_scan", true), true);
  });
});

describe("verification matrix IGIP", () => {
  it("cubre los 13 elementos de config", () => {
    assert.equal(matrixCoversAllConfigElements(IGIP_ELEMENT_DEFS), true);
    assert.equal(IGIP_VERIFICATION_MATRIX.length, 13);
  });

  it("documenta elementos sin test unitario", () => {
    const untested = untestedMatrixRows();
    assert.ok(untested.length >= 8);
  });
});

describe("form-row-extract bitácora", () => {
  const fixture = [bitacoraAguaConectaFixture()];

  it("continuidad: respuesta completa sin pregunta ni fila 21", () => {
    const r = extractFormRowFromExcel(fixture, { title: "Continuidad de fases anteriores" });
    assert.ok(r?.content);
    assert.match(r!.content, /^S[ií],?\s+este\s+proyecto/i);
    assert.doesNotMatch(r!.content, /¿El proyecto es continuidad/i);
    assert.doesNotMatch(r!.content, /fila\s+21/i);
    assert.doesNotMatch(r!.content, /consiste la soluci[oó]n propuesta/i);
  });

  it("necesidad: párrafo de la fila 19", () => {
    const r = extractFormRowFromExcel(fixture, { title: "Necesidad, problema u oportunidad" });
    assert.ok(r?.content);
    assert.match(r!.content, /Comunidad de Regantes El Zaino/i);
    assert.doesNotMatch(r!.content, /que aborda la iniciativa\.\s*$/i);
  });

  it("pertinencia local: solo bloque local", () => {
    const r = extractFormRowFromExcel(fixture, { title: "Pertinencia local" });
    assert.ok(r?.content);
    assert.match(r!.content, /iniciativa entrega informaci[oó]n/i);
    assert.doesNotMatch(r!.content, /y Disciplinar/i);
    assert.doesNotMatch(r!.content, /Permite a los estudiantes/i);
  });

  it("pertinencia local/disciplinar con encabezados Local: y Disciplinar:", () => {
    const combinedValue =
      "Local: Comuna de Ñuñoa, trabajo con JJVV y comités de copropietarios. Disciplinar: Los estudiantes de las carreras de electricidad y diseño gráfico aplicarán conocimientos técnicos.";
    const miniFixture: ExcelStructuredData[] = [
      {
        fileName: "conenergia.xlsx",
        sheets: [
          {
            sheetName: "Resumen Proyecto",
            merges: [],
            cells: [
              { row: 20, col: 1, value: "Pertinencia Local y Disciplinar." },
              { row: 20, col: 2, value: combinedValue },
            ],
          },
        ],
      },
    ];
    const local = extractFormRowFromExcel(miniFixture, { title: "Pertinencia local" });
    const disc = extractFormRowFromExcel(miniFixture, { title: "Pertinencia disciplinar" });
    assert.ok(local?.content);
    assert.match(local!.content, /Ñuñoa/i);
    assert.doesNotMatch(local!.content, /estudiantes de las carreras/i);
    assert.ok(disc?.content);
    assert.match(disc!.content, /estudiantes de las carreras/i);
    assert.doesNotMatch(disc!.content, /JJVV/i);
  });
});

describe("project-extract-llm tools (structured index)", () => {
  const fixture = bitacoraAguaConectaFixture();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-llm-extract-"));
  const sessionId = `test-${path.basename(tmp)}`;
  const filePath = path.join(tmp, "bitacora.xlsx");
  fs.writeFileSync(filePath, "x");

  saveProjectChunks(
    sessionId,
    [{ id: "1", docName: "bitacora.xlsx", text: "Agua Conecta continuidad fase anterior", embedding: [0.1] }],
    { indexedAt: new Date().toISOString(), filePaths: [filePath] }
  );
  saveProjectStructuredIndex(sessionId, {
    indexedAt: new Date().toISOString(),
    filePaths: [filePath],
    files: [
      {
        fileName: "bitacora.xlsx",
        type: "excel",
        sheets: fixture.sheets,
      },
    ],
  });

  it("get_structured_excel devuelve celdas del fixture", async () => {
    const { executeProjectExtractTool } = await import("@/lib/project-extract-tools");
    const text = await executeProjectExtractTool(sessionId, "get_structured_excel", {
      fileName: "bitacora",
    });
    assert.match(text, /Agua Conecta/);
    assert.match(text, /Objetivo general/);
    assert.match(text, /fila 3, col 1/);
  });

  it("get_project_overview lista archivos indexados", async () => {
    const { executeProjectExtractTool } = await import("@/lib/project-extract-tools");
    const text = await executeProjectExtractTool(sessionId, "get_project_overview", {});
    assert.match(text, /bitacora\.xlsx/);
    assert.match(text, /excel/);
  });
});

describe("golden bitácora — extractores determinísticos (libs base)", () => {
  const fixture = [bitacoraAguaConectaFixture()];

  for (const [title, spec] of Object.entries(BITACORA_GOLDEN)) {
    it(`${title} vía heurística Excel`, () => {
      const element = IGIP_ELEMENT_DEFS.find((e) => e.title === title);
      assert.ok(element, `elemento ${title}`);
      const heuristicMap = extractAllElementsHeuristic(fixture, [element!]);
      const heuristic = heuristicMap.get(title) ?? { content: "", confidence: 0, method: "none" };
      const content = heuristic.content;
      assert.ok(content.length >= spec.minLength, `contenido corto: ${content.length}`);
      if (spec.mustMatch) assert.match(content, spec.mustMatch);
      if (spec.mustNotMatch) assert.doesNotMatch(content, spec.mustNotMatch);
    });
  }

  it("objetivos específicos con lista numerada", () => {
    const extracted = extractSpecificObjectivesFromExcel(fixture);
    assert.ok(extracted?.content);
    assert.match(extracted!.content, /1\./);
    assert.match(extracted!.content, /plataforma web/i);
  });

  it("nombre del proyecto vía detectProjectName", () => {
    const detected = detectProjectName(fixture, []);
    assert.ok(detected);
    assert.match(detected!.text, /Agua Conecta/i);
    assert.ok(detected!.score >= 42);
  });
});

describe("project-extract-hybrid (determinista Excel)", () => {
  const fixture = [bitacoraAguaConectaFixture()];

  it("extrae Sedes y Escuelas desde etiquetas Excel", () => {
    const sedes = IGIP_ELEMENT_DEFS.find((e) => e.title === "Sedes")!;
    const escuelas = IGIP_ELEMENT_DEFS.find((e) => e.title === "Escuelas")!;
    const sedesResult = tryDeterministicExtract(fixture, sedes);
    const escuelasResult = tryDeterministicExtract(fixture, escuelas);
    assert.ok(sedesResult?.content);
    assert.match(sedesResult!.content, /San Fernando/i);
    assert.ok(escuelasResult?.content);
    assert.match(escuelasResult!.content, /Ingeniería/i);
  });

  it("extrae Necesidad desde fila de formulario", () => {
    const el = IGIP_ELEMENT_DEFS.find((e) => e.title === "Necesidad, problema u oportunidad")!;
    const result = tryDeterministicExtract(fixture, el);
    assert.ok(result?.content);
    assert.match(result!.content, /Comunidad de Regantes El Zaino/i);
  });
});

describe("isIncompleteElement", () => {
  it("marca vacío e incompleto narrativo corto", () => {
    const continuity = IGIP_ELEMENT_DEFS.find((e) => e.title === "Continuidad de fases anteriores")!;
    assert.equal(isIncompleteElement(continuity, ""), true);
    assert.equal(isIncompleteElement(continuity, "Texto corto"), true);
    assert.equal(
      isIncompleteElement(
        continuity,
        "Sí, este proyecto continúa la fase anterior con elementos innovadores claros y diferenciadores en la nueva etapa del desarrollo."
      ),
      false
    );
  });

  it("metadata corta (sedes) acepta valores breves", () => {
    const sedes = IGIP_ELEMENT_DEFS.find((e) => e.title === "Sedes")!;
    assert.equal(isIncompleteElement(sedes, "San Fernando"), false);
    assert.equal(isIncompleteElement(sedes, ""), true);
  });

  it("objetivos específicos requieren lista o longitud", () => {
    const obj = IGIP_ELEMENT_DEFS.find((e) => e.title === "Objetivos Específicos")!;
    assert.equal(isIncompleteElement(obj, "1. Desarrollar una plataforma web accesible para parceleros."), false);
    assert.equal(isIncompleteElement(obj, "corto"), true);
  });
});

describe("plainTextToStructuredData (.xls fallback)", () => {
  it("convierte filas etiqueta: valor a celdas", () => {
    const text = "[Hoja: Resumen]\nSedes: San Fernando\nEscuelas: Ingeniería Informática";
    const data = plainTextToStructuredData("legacy.xls", text);
    assert.equal(data.sheets.length, 1);
    const sedes = data.sheets[0].cells.find((c) => c.value === "Sedes");
    assert.ok(sedes);
    const value = data.sheets[0].cells.find((c) => c.row === sedes!.row && c.col === 2);
    assert.match(value?.value ?? "", /San Fernando/);
  });
});

describe("plain-text snippets PDF/DOCX", () => {
  it("PDF snippet contiene campos IGIP clave", () => {
    assert.match(PDF_FORM_SNIPPET, /Nombre del proyecto/i);
    assert.match(PDF_FORM_SNIPPET, /Objetivo general/i);
    assert.match(PDF_FORM_SNIPPET, /Objetivos específicos/i);
  });

  it("DOCX snippet contiene metadata institucional", () => {
    assert.match(DOCX_FORM_SNIPPET, /Sedes:/i);
    assert.match(DOCX_FORM_SNIPPET, /Escuelas:/i);
    assert.match(DOCX_FORM_SNIPPET, /Pertinencia disciplinar/i);
  });
});

describe("projectIndexMatches", () => {
  it("detecta mismos paths indexados (RAG + estructurado)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-extract-"));
    const sessionId = `test-${path.basename(tmp)}`;
    const fileA = path.join(tmp, "a.xlsx");
    fs.writeFileSync(fileA, "x");
    saveProjectChunks(
      sessionId,
      [{ id: "1", docName: "a.xlsx", text: "hola", embedding: [0.1] }],
      { indexedAt: new Date().toISOString(), filePaths: [fileA] }
    );
    saveProjectStructuredIndex(sessionId, {
      indexedAt: new Date().toISOString(),
      filePaths: [fileA],
      files: [{ fileName: "a.xlsx", type: "excel", sheets: [] }],
    });
    assert.equal(projectIndexMatches(sessionId, [fileA]), true);
    assert.equal(projectIndexMatches(sessionId, [fileA, path.join(tmp, "b.xlsx")]), false);
  });
});

describe("CONenergía TRL — campos ampliados", () => {
  const fixture = [conenergiaTrlFixture()];

  const cases: Array<{ title: string; mustMatch: RegExp; mustNotMatch?: RegExp }> = [
    {
      title: "Ejes de impacto o focalizaciones",
      mustMatch: /eje social|capacitando/i,
      mustNotMatch: /^social,\s*medioambiental/i,
    },
    {
      title: "Sostenibilidad",
      mustMatch: /integra sostenibilidad|talleres/i,
      mustNotMatch: /¿Cómo se integra/i,
    },
    {
      title: "Objetivo de Desarrollo Sostenible",
      mustMatch: /ODS\s*7|Energía asequible/i,
      mustNotMatch: /al que apunta el proyecto/i,
    },
    {
      title: "Resultados y contribución esperada",
      mustMatch: /capacitar|encuestas/i,
      mustNotMatch: /^\.$/,
    },
    {
      title: "Factor innovador del proyecto",
      mustMatch: /concursos de diseño|participativa/i,
      mustNotMatch: /^No$/i,
    },
    {
      title: "Escalabilidad",
      mustMatch: /replicar|otras comunas/i,
      mustNotMatch: /¿Existen planes/i,
    },
    {
      title: "En qué consiste la solución y cuál es el nivel de avance actual",
      mustMatch: /nace desde cero|ISO\s*50001|soluci/i,
    },
  ];

  for (const { title, mustMatch, mustNotMatch } of cases) {
    it(`${title} extrae respuesta útil`, () => {
      const element = { title, description: title, section: "Desarrollo Técnico" };
      const result = tryDeterministicExtract(fixture, element);
      assert.ok(result?.content, `sin contenido para ${title}`);
      assert.match(result!.content, mustMatch);
      if (mustNotMatch) assert.doesNotMatch(result!.content, mustNotMatch);
    });
  }

  it("rechaza metadata Focalización para ejes de impacto", () => {
    const element = {
      title: "Ejes de impacto o focalizaciones",
      description: "Desarrollo narrativo de cada eje",
    };
    const h = extractElementHeuristic(fixture, element);
    assert.doesNotMatch(h.content, /^social,\s*medioambiental/i);
  });

  it("Indicadores: no devuelve tabla cruda de forma determinista", () => {
    const element = { title: "Indicadores", description: "Indicadores del proyecto", section: "Indicadores" };
    const result = tryDeterministicExtract(fixture, element);
    assert.equal(result, null);
  });

  it("Actividades: no usa extracción determinista genérica (va a LLM Gantt)", () => {
    const element = {
      title: "Actividades del proyecto",
      section: "Plan de Actividades (Gantt)",
      description: "Solo nombre y descripción",
    };
    assert.equal(tryDeterministicExtract(fixture, element), null);
  });

  it("Indicadores: genera contexto etiquetado para el LLM", () => {
    const ctx = getIndicatorsSheetContext(fixture);
    assert.ok(ctx);
    assert.match(ctx, /Familias capacitadas/i);
    assert.match(ctx, /Registro 1|Encabezados/i);
    assert.doesNotMatch(ctx, /^\d+\.\s+.+\|/m);
  });

  it("Gantt: genera contexto de hoja para fallback LLM", () => {
    const ctx = getGanttSheetContext(fixture);
    assert.ok(ctx);
    assert.match(ctx, /Diagnóstico de consumo|Talleres de eficiencia/i);
    assert.match(ctx, /Descripción/i);
    assert.doesNotMatch(ctx, /Equipo técnico|Docentes electricidad/i);
  });

  it("Gantt: solo nombre y descripción por actividad", () => {
    const element = {
      title: "Actividades del proyecto",
      section: "Plan de Actividades (Gantt)",
      description: "Solo nombre y descripción de actividad",
    };
    const extracted = extractGanttActivitiesFromExcel(fixture, element);
    assert.ok(extracted?.content);
    assert.match(extracted!.content, /Diagnóstico de consumo/i);
    assert.match(extracted!.content, /Relevamiento del consumo/i);
    assert.doesNotMatch(extracted!.content, /Equipo técnico/i);
    assert.doesNotMatch(extracted!.content, /Tareas:/i);
  });

  it("Gantt: reconoce elemento por sección Plan de Actividades", () => {
    assert.equal(
      isGanttActivitiesElement({
        title: "Actividades del proyecto",
        section: "Plan de Actividades (Gantt)",
        description: "Listado de tareas",
      }),
      true
    );
  });
});

describe("extract_config genérico TRL", () => {
  it("enruta hojas con sheetPatterns personalizados", () => {
    const trlPatterns = {
      gantt: "cronograma|timeline",
      indicators: "metric|kpi",
      resumen: "overview|summary",
    };
    const sheets = [
      { sheetName: "Project Overview", cells: [], merges: [] },
      { sheetName: "Timeline 2025", cells: [], merges: [] },
    ];
    const element = {
      title: "Actividades del proyecto",
      section: "Cronograma",
      description: "actividades del proyecto en gantt",
    };
    assert.equal(isGanttSheetName("Timeline 2025", trlPatterns), true);
    assert.equal(isGanttSheetName("Plan de Actividades", trlPatterns), false);
    const ordered = sheetsForElement(element, sheets, trlPatterns);
    assert.equal(ordered[0]?.sheetName, "Timeline 2025");
  });

  it("mergeEvaluationTypeSettings aplica defaults TRL mínimos", () => {
    const merged = mergeEvaluationTypeSettings(
      {
        extract_config: {
          sheetPatterns: { gantt: "timeline", indicators: "kpi", resumen: "summary" },
          elementTimeoutMs: 60_000,
        },
      },
      "TRL"
    );
    assert.equal(merged.pipeline.indicatorLabel, "TRL");
    assert.equal(merged.extract.elementTimeoutMs, 60_000);
    assert.match(merged.extract.sheetPatterns.gantt, /timeline/);
  });
});

describe("stripIndexedCellMetadata", () => {
  it("elimina marcadores de chunk RAG", () => {
    const raw = "(fila 21, col 5): La solución propuesta consiste en una página web.";
    assert.equal(stripIndexedCellMetadata(raw), "La solución propuesta consiste en una página web.");
  });
});

describe("extract IMET formulario Q/A", () => {
  it("detecta layout pregunta-respuesta en columna A/B", async () => {
    const fixture = [await imetDocuCoreFixture()];
    assert.equal(isQaColumnWorkbook(fixture), true);
  });

  it("extrae campos IMET desde Excel de dos columnas", async () => {
    const fixture = [await imetDocuCoreFixture()];
    const results = extractAllElementsHeuristic(fixture, IMET_ELEMENT_DEFS);

    for (const el of IMET_ELEMENT_DEFS) {
      const match = results.get(el.title);
      const golden = IMET_DOCUCORE_GOLDEN[el.title];
      assert.ok(match?.content, `sin contenido para ${el.title}`);
      assert.ok(match!.content.length >= golden.minLength, el.title);
      if (golden.mustMatch) assert.match(match!.content, golden.mustMatch, el.title);
      if (golden.mustNotMatch) assert.doesNotMatch(match!.content, golden.mustNotMatch, el.title);
    }
  });

  it("tryDeterministicExtract resuelve nombre y avance sin LLM", async () => {
    const fixture = [await imetDocuCoreFixture()];

    const name = tryDeterministicExtract(fixture, {
      title: "Nombre del proyecto",
      description: "Nombre del emprendimiento",
    });
    assert.ok(name?.content);
    assert.match(name!.content, /DocuCore/i);

    const advance = tryDeterministicExtract(fixture, {
      title: "Avance actual",
      description: "Estado de avance del proyecto",
      section: "Desarrollo Técnico",
    });
    assert.ok(advance?.content);
    assert.match(advance!.content, /prototipo|plataforma funcional/i);
    assert.match(advance!.method, /qa_column|form_row/);
  });
});
