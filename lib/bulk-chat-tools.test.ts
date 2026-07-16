import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BulkChatProject } from "@/lib/bulk-chat-types";
import {
  findBulkProject,
  getBulkProjectDetail,
  listBulkProjectsSummary,
  searchBulkProjects,
} from "@/lib/bulk-chat-tools";

const projects: BulkChatProject[] = [
  {
    id: "bulk-0-a",
    projectName: "ClinicApp",
    fileName: "clinic.xlsx",
    elementsTable: [{ element: "Objetivo general", content: "App de salud" }],
    subdimensionScores: { transferencia: 3 },
    overallScore: 2.6,
    summary: "Proyecto con transferencia tecnológica clara.",
    reportContent: "### Transferencia Tecnológica\nNota: 3\nPlataforma digital funcional.",
  },
  {
    id: "bulk-1-b",
    projectName: "CONenergía",
    fileName: "con.xlsx",
    elementsTable: [{ element: "Objetivo general", content: "Consultoría energética" }],
    subdimensionScores: { transferencia: 2 },
    overallScore: 2.5,
    summary: "Consultoría sin herramienta digital propia.",
    reportContent: "### Transferencia Tecnológica\nNota: 2\nSin prototipo tecnológico.",
  },
];

describe("bulk-chat-tools", () => {
  it("lista proyectos masivos", () => {
    const text = listBulkProjectsSummary(projects);
    assert.match(text, /ClinicApp/);
    assert.match(text, /CONenergía/);
    assert.match(text, /transferencia: 3/);
  });

  it("encuentra proyecto por nombre", () => {
    const p = findBulkProject(projects, "CONenergía");
    assert.equal(p?.projectName, "CONenergía");
  });

  it("devuelve detalle con extracts e informe", () => {
    const detail = getBulkProjectDetail(projects[1]!);
    assert.match(detail, /Consultoría energética/);
    assert.match(detail, /Sin prototipo tecnológico/);
  });

  it("busca en todos los proyectos", () => {
    const hits = searchBulkProjects(projects, "plataforma digital");
    assert.match(hits, /ClinicApp/);
    assert.doesNotMatch(hits, /Sin coincidencias/);
  });
});
