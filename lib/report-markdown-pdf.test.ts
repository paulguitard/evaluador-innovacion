import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMarkdownInlines, parseReportMarkdown } from "@/lib/report-markdown-pdf";

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
});
