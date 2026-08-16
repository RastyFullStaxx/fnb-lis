import ExcelJS from "exceljs";
import { toCsv, type CsvValue } from "@fnb/core";
import {
  exportStamp,
  moneyCell,
  stampLogo,
  styleHeaderRow,
  titleBlock,
  toBuffer,
  type ReportMeta,
} from "./exports";
import type { VarianceSummaryReport, VarianceSummaryRow } from "./report-variance-summary";
import { tablePdf, type PdfRow } from "./pdf";

/** Same "Exported by X · <timestamp>" line every other export's PDF/CSV
    carries (exports-suite.ts's local stampLine, mirrored here since this
    report's formatters live in their own file per the plan). */
function stampLine(meta: ReportMeta): string {
  return meta.exportedBy ? `Exported by ${meta.exportedBy} · ${exportStamp()}` : "";
}

/**
 * Variance Summary Report exports (client req, version 2 of the existing
 * Variance Report #10). Category rows only, no item rows.
 *
 * Category, Variances, Brands, Short, Over, Remarks — SAME six columns in
 * every format (CSV, PDF, XLSX) and on screen, matching the client's own
 * sheet layout. Remarks is free text the client types in; it is never
 * dropped from any export, only ever blank until they fill it in.
 */

// ───────────────── Variance Summary ─────────────────

// CSV and PDF are flat, single-header-row formats (toCsv / tablePdf support
// no group-header row — same constraint legacyAuditCsv/legacyAuditPdf live
// with; the two-row "Variance at Retail" grouping is XLSX + on-screen only).
// The Short/Over columns are labelled with the group folded in so the peso
// figures aren't ambiguous without it.
const VARIANCE_SUMMARY_HEADERS = [
  "Category",
  "Variances",
  "Brands",
  "Short (At Retail)",
  "Over (At Retail)",
  "Remarks",
];
const VARIANCE_SUMMARY_HEADERS_XLSX = ["Category", "Variances", "Brands", "Short", "Over", "Remarks"];

function varianceSummaryRowCells(r: VarianceSummaryRow): CsvValue[] {
  return [
    r.categoryName.toUpperCase(),
    r.status,
    r.brands,
    r.short || "",
    r.over || "",
    r.remarks || "",
  ];
}

export async function varianceSummaryWorkbook(
  report: VarianceSummaryReport,
  meta: ReportMeta,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Variance Summary", { views: [{ state: "frozen", ySplit: 5 }] });
  titleBlock(
    ws,
    "Variance Summary Report",
    `${meta.clientName} · ${meta.locationName} · ${report.period.beginDate} → ${report.period.endDate} (activity up to, not including, the ending date)`,
    VARIANCE_SUMMARY_HEADERS_XLSX.length,
    meta,
  );

  // Two-row header (rows 4-5): row 4 carries only the "Variance at Retail"
  // group label over Short/Over; row 5 carries every column's own label,
  // Category/Variances/Brands/Remarks included — no merge on those columns,
  // so row 5 isn't swallowed into the row-4 merge and left blank.
  const groupRow = ws.addRow(["", "", "", "Variance at Retail", "", ""]);
  const subRow = ws.addRow(VARIANCE_SUMMARY_HEADERS_XLSX);
  ws.mergeCells("D4:E4");
  styleHeaderRow(groupRow);
  styleHeaderRow(subRow);
  groupRow.alignment = { horizontal: "center", vertical: "middle" };

  for (const r of report.rows) {
    const row = ws.addRow([r.categoryName.toUpperCase(), r.status, r.brands]);
    if (r.short) moneyCell(row.getCell(4), r.short, false);
    if (r.over) moneyCell(row.getCell(5), r.over, false);
    // Remarks (col 6): whatever's already on the row prints here; the cell
    // stays unlocked either way so the client can add to or edit it after
    // download — never wiped, never protected, never a formula.
    row.getCell(6).value = r.remarks || "";
  }
  const t = ws.addRow(["GRAND TOTAL", "", "", "", "", ""]);
  moneyCell(t.getCell(4), report.totals.short, false);
  moneyCell(t.getCell(5), report.totals.over, false);
  t.font = { bold: true };
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 48;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 30;
  stampLogo(ws, VARIANCE_SUMMARY_HEADERS_XLSX.length);
  return toBuffer(wb);
}

export function varianceSummaryCsv(report: VarianceSummaryReport): string {
  return toCsv([
    [`Variance Summary Report · ${report.period.beginDate} → ${report.period.endDate}`],
    VARIANCE_SUMMARY_HEADERS,
    ...report.rows.map(varianceSummaryRowCells),
    ["GRAND TOTAL", "", "", report.totals.short || "", report.totals.over || "", ""],
  ]);
}

export function varianceSummaryPdf(
  report: VarianceSummaryReport,
  meta: ReportMeta,
): Promise<Buffer> {
  const rows: PdfRow[] = report.rows.map((r) => ({
    cells: varianceSummaryRowCells(r) as (string | number)[],
  }));
  rows.push({
    cells: ["GRAND TOTAL", "", "", report.totals.short || "", report.totals.over || "", ""],
    kind: "total",
  });
  return tablePdf({
    title: "Variance Summary Report",
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.period.beginDate} → ${report.period.endDate} (activity up to, not including, the ending date)`,
    columns: VARIANCE_SUMMARY_HEADERS.map((h, i) => ({
      header: h,
      align: i < 3 || i === 5 ? "left" : "right",
      width: i === 2 || i === 5 ? "*" : "auto",
    })),
    rows,
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
    landscape: true,
  });
}
