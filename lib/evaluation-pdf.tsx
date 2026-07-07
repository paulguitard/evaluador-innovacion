import React from "react";
import {
  parseReportMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from "@/lib/report-markdown-pdf";

type PdfTextLike = React.ComponentType<{
  style?: object;
  children?: React.ReactNode;
}>;

function renderMarkdownInlines(
  PdfText: PdfTextLike,
  inlines: MarkdownInline[],
  baseStyle?: object
): React.ReactNode {
  if (inlines.length === 0) return null;
  if (inlines.length === 1 && !inlines[0].bold) {
    return <PdfText style={baseStyle}>{inlines[0].text}</PdfText>;
  }
  return (
    <PdfText style={baseStyle}>
      {inlines.map((part, i) =>
        part.bold ? (
          <PdfText key={i} style={{ fontWeight: "bold" }}>
            {part.text}
          </PdfText>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        )
      )}
    </PdfText>
  );
}

function renderReportMarkdownBlocks(
  PdfText: PdfTextLike,
  blocks: MarkdownBlock[],
  styles: {
    body: object;
    h2: object;
    h3: object;
    hr: object;
    blank: object;
  }
): React.ReactNode[] {
  return blocks.map((block, i) => {
    switch (block.type) {
      case "h2":
        return (
          <React.Fragment key={i}>
            {renderMarkdownInlines(PdfText, block.inlines, styles.h2)}
          </React.Fragment>
        );
      case "h3":
        return (
          <React.Fragment key={i}>
            {renderMarkdownInlines(PdfText, block.inlines, styles.h3)}
          </React.Fragment>
        );
      case "hr":
        return (
          <PdfText key={i} style={styles.hr}>
            {" "}
          </PdfText>
        );
      case "blank":
        return (
          <PdfText key={i} style={styles.blank}>
            {" "}
          </PdfText>
        );
      case "paragraph":
        return (
          <React.Fragment key={i}>
            {renderMarkdownInlines(PdfText, block.inlines, styles.body)}
          </React.Fragment>
        );
      default:
        return null;
    }
  });
}

export async function generateEvaluationPdfBlob(
  title: string,
  body: string
): Promise<Blob> {
  const { Document: Doc, Page: PdfPage, Text: PdfText, StyleSheet: SS, pdf: pdfFn } =
    await import("@react-pdf/renderer");

  const pdfStyles = SS.create({
    page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
    title: { fontSize: 16, marginBottom: 20, fontWeight: "bold" },
    body: { fontSize: 11, lineHeight: 1.5, marginBottom: 6 },
    h2: {
      fontSize: 14,
      fontWeight: "bold",
      marginTop: 14,
      marginBottom: 8,
      lineHeight: 1.4,
    },
    h3: {
      fontSize: 12,
      fontWeight: "bold",
      marginTop: 10,
      marginBottom: 6,
      lineHeight: 1.4,
    },
    hr: { marginVertical: 10, borderBottomWidth: 1, borderBottomColor: "#cccccc" },
    blank: { marginBottom: 6 },
  });

  const content = body?.trim() || "Sin contenido de informe.";
  const blocks = parseReportMarkdown(content);

  const doc = (
    <Doc>
      <PdfPage size="A4" style={pdfStyles.page}>
        <PdfText style={pdfStyles.title}>{title || "Informe de evaluación"}</PdfText>
        {renderReportMarkdownBlocks(PdfText as PdfTextLike, blocks, {
          body: pdfStyles.body,
          h2: pdfStyles.h2,
          h3: pdfStyles.h3,
          hr: pdfStyles.hr,
          blank: pdfStyles.blank,
        })}
      </PdfPage>
    </Doc>
  );

  return pdfFn(doc).toBlob();
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-\u00C0-\u024F ]/g, "_").slice(0, 120);
}
