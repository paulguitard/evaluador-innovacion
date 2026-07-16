import React from "react";
import {
  parseReportMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownTableBlock,
} from "@/lib/report-markdown-pdf";

type PdfTextLike = React.ComponentType<{
  style?: object;
  children?: React.ReactNode;
}>;

type PdfViewLike = React.ComponentType<{
  style?: object;
  wrap?: boolean;
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

function renderMarkdownTable(
  PdfView: PdfViewLike,
  PdfText: PdfTextLike,
  table: MarkdownTableBlock,
  styles: {
    table: object;
    tableRow: object;
    tableHeaderRow: object;
    tableCell: object;
    tableCellLast: object;
    tableHeaderCell: object;
    tableHeaderCellLast: object;
  }
): React.ReactNode {
  const columnCount = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1);

  const renderRow = (
    cells: string[],
    rowStyle: object,
    cellStyle: object,
    lastCellStyle: object,
    rowKey?: string | number
  ) => (
    <PdfView key={rowKey} style={rowStyle} wrap={false}>
      {Array.from({ length: columnCount }, (_, columnIndex) => {
        const isLast = columnIndex === columnCount - 1;
        return (
          <PdfText
            key={columnIndex}
            style={isLast ? lastCellStyle : cellStyle}
          >
            {cells[columnIndex] ?? ""}
          </PdfText>
        );
      })}
    </PdfView>
  );

  return (
    <PdfView style={styles.table}>
      {renderRow(table.headers, styles.tableHeaderRow, styles.tableHeaderCell, styles.tableHeaderCellLast)}
      {table.rows.map((row, rowIndex) =>
        renderRow(row, styles.tableRow, styles.tableCell, styles.tableCellLast, `row-${rowIndex}`)
      )}
    </PdfView>
  );
}

function renderReportMarkdownBlocks(
  PdfView: PdfViewLike,
  PdfText: PdfTextLike,
  blocks: MarkdownBlock[],
  styles: {
    body: object;
    h2: object;
    h3: object;
    hr: object;
    blank: object;
    table: object;
    tableRow: object;
    tableHeaderRow: object;
    tableCell: object;
    tableCellLast: object;
    tableHeaderCell: object;
    tableHeaderCellLast: object;
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
      case "table":
        return (
          <React.Fragment key={i}>
            {renderMarkdownTable(PdfView, PdfText, block, {
              table: styles.table,
              tableRow: styles.tableRow,
              tableHeaderRow: styles.tableHeaderRow,
              tableCell: styles.tableCell,
              tableCellLast: styles.tableCellLast,
              tableHeaderCell: styles.tableHeaderCell,
              tableHeaderCellLast: styles.tableHeaderCellLast,
            })}
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
  const { Document: Doc, Page: PdfPage, Text: PdfText, View: PdfView, StyleSheet: SS, pdf: pdfFn } =
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
    table: {
      marginTop: 4,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: "#cccccc",
    },
    tableHeaderRow: {
      flexDirection: "row",
      backgroundColor: "#f3f4f6",
      borderBottomWidth: 1,
      borderBottomColor: "#cccccc",
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: "#e5e7eb",
    },
    tableHeaderCell: {
      flex: 3,
      paddingVertical: 6,
      paddingHorizontal: 8,
      fontSize: 10,
      fontWeight: "bold",
      borderRightWidth: 1,
      borderRightColor: "#cccccc",
    },
    tableHeaderCellLast: {
      flex: 1,
      paddingVertical: 6,
      paddingHorizontal: 8,
      fontSize: 10,
      fontWeight: "bold",
      textAlign: "center",
    },
    tableCell: {
      flex: 3,
      paddingVertical: 5,
      paddingHorizontal: 8,
      fontSize: 10,
      lineHeight: 1.35,
      borderRightWidth: 1,
      borderRightColor: "#e5e7eb",
    },
    tableCellLast: {
      flex: 1,
      paddingVertical: 5,
      paddingHorizontal: 8,
      fontSize: 10,
      lineHeight: 1.35,
      textAlign: "center",
    },
  });

  const content = body?.trim() || "Sin contenido de informe.";
  const blocks = parseReportMarkdown(content);

  const doc = (
    <Doc>
      <PdfPage size="A4" style={pdfStyles.page}>
        <PdfText style={pdfStyles.title}>{title || "Informe de evaluación"}</PdfText>
        {renderReportMarkdownBlocks(PdfView as PdfViewLike, PdfText as PdfTextLike, blocks, {
          body: pdfStyles.body,
          h2: pdfStyles.h2,
          h3: pdfStyles.h3,
          hr: pdfStyles.hr,
          blank: pdfStyles.blank,
          table: pdfStyles.table,
          tableRow: pdfStyles.tableRow,
          tableHeaderRow: pdfStyles.tableHeaderRow,
          tableCell: pdfStyles.tableCell,
          tableCellLast: pdfStyles.tableCellLast,
          tableHeaderCell: pdfStyles.tableHeaderCell,
          tableHeaderCellLast: pdfStyles.tableHeaderCellLast,
        })}
      </PdfPage>
    </Doc>
  );

  return pdfFn(doc).toBlob();
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-\u00C0-\u024F ]/g, "_").slice(0, 120);
}
