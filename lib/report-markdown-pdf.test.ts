import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandCollapsedMarkdownTableLines,
  isMarkdownTableRow,
  isMarkdownTableSeparator,
  parseMarkdownInlines,
  parseMarkdownTableRow,
  parseReportMarkdown,
} from "@/lib/report-markdown-pdf";

describe("parseMarkdownInlines", () => {
  it("parsea negritas", () => {
    const parts = parseMarkdownInlines("**Análisis** del proyecto");
    assert.equal(parts.length, 2);
    assert.equal(parts[0].text, "Análisis");
    assert.equal(parts[0].bold, true);
    assert.equal(parts[1].text, " del proyecto");
    assert.equal(parts[1].bold, false);
  });
});

describe("parseReportMarkdown", () => {
  it("parsea encabezados y párrafos", () => {
    const md = `## Resumen del proyecto
Texto del resumen.

### Subsección
**Nota:** 3`;
    const blocks = parseReportMarkdown(md);
    assert.equal(blocks[0].type, "h2");
    assert.equal(blocks.filter((b) => b.type === "paragraph").length, 2);
    assert.ok(blocks.some((b) => b.type === "h3"));
  });

  it("convierte --- en hr sin literal", () => {
    const blocks = parseReportMarkdown("## A\n\n---\n\n## B");
    assert.ok(blocks.some((b) => b.type === "hr"));
    assert.ok(!blocks.some((b) => b.type === "paragraph" && "inlines" in b && b.inlines[0]?.text === "---"));
  });

  it("parsea tablas Markdown de notas e índice", () => {
    const md = `**Notas e índice**

| Subdimensión | Nota |
| --- | --- |
| Grado de Originalidad de la Idea | 2 |
| Estado del arte | 1 |

**Índice IGIP**: 2.65`;
    const blocks = parseReportMarkdown(md);
    const table = blocks.find((b) => b.type === "table");
    assert.ok(table);
    assert.equal(table?.type, "table");
    if (table?.type !== "table") return;
    assert.deepEqual(table.headers, ["Subdimensión", "Nota"]);
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0]?.[0], "Grado de Originalidad de la Idea");
    assert.equal(table.rows[0]?.[1], "2");
    assert.ok(blocks.some((b) => b.type === "paragraph" && b.inlines.some((p) => p.text.includes("Índice IGIP"))));
  });

  it("repara tablas colapsadas en una sola línea", () => {
    const collapsed =
      "| Subdimensión | Nota | | --- | --- | | Grado de Originalidad de la Idea | 2 | | Estado del arte | 1 |";
    const expanded = expandCollapsedMarkdownTableLines(collapsed);
    assert.match(expanded, /\n/);
    const blocks = parseReportMarkdown(`**Notas e índice**\n\n${collapsed}`);
    const table = blocks.find((b) => b.type === "table");
    assert.ok(table);
    if (table?.type !== "table") return;
    assert.equal(table.rows.length, 2);
  });
});

describe("markdown table helpers", () => {
  it("detecta filas y separadores", () => {
    assert.equal(isMarkdownTableRow("| A | B |"), true);
    assert.equal(isMarkdownTableRow("texto | A |"), false);
    assert.equal(isMarkdownTableSeparator("| --- | --- |"), true);
    assert.equal(parseMarkdownTableRow("| A | B |").join(","), "A,B");
  });
});
