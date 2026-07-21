import PdfPrinter from "pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

/**
 * Generic tabular report → PDF (client req 2026-07-20: every report downloads
 * as Excel, CSV, or PDF). One renderer, thin per-report adapters: title block,
 * two-tone header, group/total row styling, exported-by footer — visually in
 * line with the XLSX exports.
 *
 * Standard-14 fonts only (no font files to ship). Helvetica's WinAnsi encoding
 * has no ₱ glyph, so money columns are plain numbers with "(PHP)" in the
 * header — never a broken glyph in a client-facing file.
 */

const printer = new PdfPrinter({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});

const BLUE = "#1b4ed8";
const INK = "#26282e";
const MUTED = "#6b7280";
const HEADER_FILL = "#eef0f5";
const GROUP_FILL = "#f4f5f8";

export interface PdfColumn {
  header: string;
  align?: "left" | "right";
  /** pdfmake width: "*" grows, "auto" fits; default "auto" ("*" for col 0). */
  width?: string | number;
}

export interface PdfRow {
  cells: (string | number)[];
  kind?: "data" | "group" | "total";
  /** Optional row background (hex) — used to highlight material over/short rows
      in the Full Audit, so the download matches the on-screen tint. */
  fill?: string;
}

export interface PdfTableSpec {
  title: string;
  subtitle: string;
  columns: PdfColumn[];
  rows: PdfRow[];
  /** "Exported by …" footer line (same fact the XLSX/CSV exports carry). */
  exportedBy: string;
  /** Optional client report footer (company info settings). */
  reportFooter?: string | null;
  landscape?: boolean;
}

function cellText(value: string | number): string {
  if (typeof value === "number") {
    return value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return value;
}

export function tablePdf(spec: PdfTableSpec): Promise<Buffer> {
  const colCount = spec.columns.length;
  const widths = spec.columns.map((c, i) => c.width ?? (i === 0 ? "*" : "auto"));

  const headerRow = spec.columns.map((c) => ({
    text: c.header,
    bold: true,
    fontSize: 7.5,
    color: INK,
    fillColor: HEADER_FILL,
    alignment: c.align ?? "left",
  }));

  const body = [
    headerRow,
    ...spec.rows.map((row) => {
      if (row.kind === "group") {
        return spec.columns.map((_, i) => ({
          text: i === 0 ? cellText(row.cells[0] ?? "") : cellText(row.cells[i] ?? ""),
          bold: true,
          fontSize: 7.5,
          fillColor: GROUP_FILL,
          color: INK,
          alignment: i === 0 ? ("left" as const) : (spec.columns[i]?.align ?? "left"),
        }));
      }
      return spec.columns.map((c, i) => ({
        text: cellText(row.cells[i] ?? ""),
        fontSize: 7.5,
        bold: row.kind === "total",
        color: row.kind === "total" ? INK : undefined,
        fillColor: row.kind === "total" ? HEADER_FILL : row.fill,
        alignment: c.align ?? "left",
      }));
    }),
  ];

  const content: Content = [
    { text: spec.title, fontSize: 15, bold: true, color: BLUE },
    { text: spec.subtitle, fontSize: 8.5, color: MUTED, margin: [0, 2, 0, 10] },
    {
      table: {
        headerRows: 1,
        widths,
        body,
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0,
        hLineColor: () => "#e0e3e9",
        paddingLeft: () => 4,
        paddingRight: () => 4,
        paddingTop: () => 2.5,
        paddingBottom: () => 2.5,
      },
    },
  ];

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: spec.landscape ?? colCount > 8 ? "landscape" : "portrait",
    pageMargins: [28, 28, 28, 40],
    defaultStyle: { font: "Helvetica", fontSize: 8 },
    content,
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: [spec.exportedBy, spec.reportFooter ? ` · ${spec.reportFooter}` : ""].join(""),
          fontSize: 7,
          color: MUTED,
        },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: "right", fontSize: 7, color: MUTED },
      ],
      margin: [28, 12, 28, 0],
    }),
  };

  return new Promise<Buffer>((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(doc);
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}
