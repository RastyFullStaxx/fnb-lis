import ExcelJS from "exceljs";
import { round2, toCsv, type CsvValue, type ReconReport, type ReconRow, type ReconTotals } from "@fnb/core";
import type {
  CostAnalysisReport,
  NonRevenueReport,
  OnHandReport,
  PurchaseReport,
  SalesReport,
  TransferReport,
} from "./report-lists";
import type { TopSellersReport } from "./top-sellers";

// Palette (ARGB). Royal blue header, light-blue group rows, red negatives.
const BLUE = "FF3A56E4";
const LIGHT = "FFEEF1FD";
const RED = "FFB42318";
const WHITE = "FFFFFFFF";
const MONEY = "#,##0.00";
const QTY = "#,##0.######";

export interface ReportMeta {
  clientName: string;
  locationName: string;
  legalName?: string;
  address?: string;
  footer?: string;
  /** "First Last" of the user who requested the export — audit traceability. */
  exportedBy?: string;
}

type Cell = ExcelJS.Cell;

/** UTC timestamp for export traceability lines, e.g. "2026-07-19 06:32 UTC". */
export function exportStamp(): string {
  return `${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/** Branded print footer — company on the left, generated note on the right.
 *  Set on the sheet's headerFooter so it never disturbs the on-sheet layout. */
export function brandFooter(ws: ExcelJS.Worksheet, meta: ReportMeta) {
  const left = [meta.legalName || meta.clientName, meta.address].filter(Boolean).join(" · ");
  const right = [
    meta.footer || "Prepared with Liquor Inventory Solution",
    meta.exportedBy ? `Exported by ${meta.exportedBy} · ${exportStamp()}` : null,
  ]
    .filter(Boolean)
    .join(" — ");
  ws.headerFooter.oddFooter = `&L&8${left}&R&8${right}`;
}

export function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: WHITE } };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    cell.alignment = { vertical: "middle" };
  });
}

export function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number, meta: ReportMeta) {
  const last = String.fromCharCode(64 + colCount);
  ws.mergeCells(`A1:${last}1`);
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 15, color: { argb: BLUE } };
  ws.mergeCells(`A2:${last}2`);
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };
  ws.addRow([]);
  brandFooter(ws, meta);
}

export function moneyCell(cell: Cell, value: number, negativeRed = true) {
  cell.value = round2(value);
  cell.numFmt = MONEY;
  cell.alignment = { horizontal: "right" };
  if (negativeRed && value < 0) cell.font = { color: { argb: RED } };
}

export function qtyCell(cell: Cell, value: number, negativeRed = false) {
  cell.value = round2(value);
  cell.numFmt = QTY;
  cell.alignment = { horizontal: "right" };
  if (negativeRed && value < 0) cell.font = { color: { argb: RED } };
}

export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  wb.creator = "Liquor Inventory Solution";
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

// ───────────────────────── Full Audit ─────────────────────────
// One declarative column spec drives the header row, every data cell, the
// grand-total row, AND the CSV — the workbook and CSV can never disagree, and
// adding/renaming/moving a column is a single-array edit (the old builders
// addressed cells by hardcoded index, which made any insertion a hazard).

export interface FullAuditColumn {
  header: string;
  kind: "qty" | "qtyRed" | "money" | "moneyPlain" | "pct";
  value: (r: ReconRow) => number | null;
  /** Present only on columns that appear in the grand-total row. */
  total?: (t: ReconTotals) => number;
}

export const FULL_AUDIT_COLUMNS: FullAuditColumn[] = [
  { header: "Begin full", kind: "qty", value: (r) => r.beginFull },
  { header: "Begin open", kind: "qty", value: (r) => r.beginOpenEquiv },
  { header: "Purchased", kind: "qty", value: (r) => r.purchased },
  { header: "Returns", kind: "qty", value: (r) => r.forfeited },
  { header: "Transferred in", kind: "qty", value: (r) => r.transferIn },
  { header: "Transferred out", kind: "qty", value: (r) => r.transferOut },
  { header: "End full", kind: "qty", value: (r) => r.endFull },
  { header: "End open", kind: "qty", value: (r) => r.endOpenEquiv },
  { header: "Usage", kind: "qty", value: (r) => r.usage },
  { header: "Sold direct", kind: "qty", value: (r) => r.soldDirect },
  { header: "Sold recipe", kind: "qty", value: (r) => r.soldPortion },
  { header: "Non-rev", kind: "qty", value: (r) => r.nonRevenue },
  { header: "Production", kind: "qty", value: (r) => r.production },
  { header: "Revenue", kind: "moneyPlain", value: (r) => r.revenue, total: (t) => t.revenue },
  // "Variance vs Sold", not "Variance" — client req #2: the label must say
  // what the number is (expected-sold minus usage) on every module's report.
  { header: "Variance vs Sold", kind: "qtyRed", value: (r) => r.variance },
  { header: "%", kind: "pct", value: (r) => r.variancePct },
  { header: "At cost", kind: "money", value: (r) => r.varianceCost, total: (t) => t.varianceCost },
  { header: "At retail", kind: "money", value: (r) => r.varianceRetail, total: (t) => t.varianceRetail },
];

function fullAuditCell(cell: Cell, kind: FullAuditColumn["kind"], value: number | null) {
  if (kind === "pct") {
    cell.value = value === null ? "—" : round2(value);
    if (value !== null) cell.numFmt = '0.00"%"';
    cell.alignment = { horizontal: "right" };
    if (value !== null && value < 0) cell.font = { color: { argb: RED } };
    return;
  }
  const v = value ?? 0;
  if (kind === "money") moneyCell(cell, v);
  else if (kind === "moneyPlain") moneyCell(cell, v, false);
  else qtyCell(cell, v, kind === "qtyRed");
}

export async function fullAuditWorkbook(report: ReconReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Full Audit", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  const colCount = FULL_AUDIT_COLUMNS.length + 1; // + Item column

  titleBlock(
    ws,
    "Full Audit Report",
    `${meta.clientName} · ${meta.locationName} · ${report.period.beginDate} → ${report.period.endDate} (activity up to, not including, the ending date)`,
    colCount,
    meta,
  );
  styleHeaderRow(ws.addRow(["Item", ...FULL_AUDIT_COLUMNS.map((c) => c.header)]));

  for (const group of report.categories) {
    const groupRow = ws.addRow([group.categoryName]);
    groupRow.font = { bold: true };
    groupRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    });
    for (const row of group.rows) {
      const r = ws.addRow([row.itemName]);
      FULL_AUDIT_COLUMNS.forEach((col, i) => fullAuditCell(r.getCell(i + 2), col.kind, col.value(row)));
    }
  }

  const totalRow = ws.addRow(["Grand total"]);
  totalRow.font = { bold: true };
  const INK = "FF111827";
  FULL_AUDIT_COLUMNS.forEach((col, i) => {
    if (!col.total) return;
    const value = col.total(report.totals);
    const cell = totalRow.getCell(i + 2);
    fullAuditCell(cell, col.kind, value);
    cell.font = { bold: true, color: { argb: col.kind === "money" && value < 0 ? RED : INK } };
  });

  ws.getColumn(1).width = 30;
  for (let i = 2; i <= colCount; i++) ws.getColumn(i).width = 11;

  return toBuffer(wb);
}

export function fullAuditCsv(report: ReconReport): string {
  const rows: CsvValue[][] = [["Item", ...FULL_AUDIT_COLUMNS.map((c) => c.header)]];
  for (const group of report.categories) {
    rows.push([group.categoryName]);
    for (const row of group.rows) {
      rows.push([
        row.itemName,
        ...FULL_AUDIT_COLUMNS.map((col): CsvValue => {
          const v = col.value(row);
          return v === null ? "" : round2(v);
        }),
      ]);
    }
  }
  rows.push([
    "Grand total",
    ...FULL_AUDIT_COLUMNS.map((col): CsvValue => (col.total ? round2(col.total(report.totals)) : "")),
  ]);
  return toCsv(rows);
}

// ───────────────────────── Sales ─────────────────────────

export const SALES_HEADERS = ["Date", "Item / Menu", "Type", "Category", "Qty", "Unit price", "Discount %", "Gross", "Net"];

export async function salesWorkbook(report: SalesReport, meta: ReportMeta, title = "Sales Report"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales", { views: [{ state: "frozen", ySplit: 4 }] });
  // The in-file title must name the view — a "Discounted" subset whose sheet
  // says "Sales Report, Total X" misfiles as the period's full sales total.
  titleBlock(ws, title, `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`, SALES_HEADERS.length, meta);
  styleHeaderRow(ws.addRow(SALES_HEADERS));
  for (const row of report.rows) {
    const r = ws.addRow([row.saleDate, row.name, row.kind === "menu" ? "Menu" : "Item", row.category ?? ""]);
    qtyCell(r.getCell(5), row.qty);
    moneyCell(r.getCell(6), row.unitPrice, false);
    r.getCell(7).value = row.discountPct || 0;
    r.getCell(7).alignment = { horizontal: "right" };
    moneyCell(r.getCell(8), row.gross, false);
    moneyCell(r.getCell(9), row.net, false);
  }
  const t = ws.addRow(["Total", "", "", ""]);
  t.font = { bold: true };
  qtyCell(t.getCell(5), report.totals.qty);
  moneyCell(t.getCell(8), report.totals.gross, false);
  moneyCell(t.getCell(9), report.totals.net, false);
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 32;
  for (let i = 3; i <= SALES_HEADERS.length; i++) ws.getColumn(i).width = 12;
  return toBuffer(wb);
}

export function salesCsv(report: SalesReport, title = "Sales Report"): string {
  const rows: CsvValue[][] = [[`${title} · ${report.from} → ${report.to}`], SALES_HEADERS];
  for (const row of report.rows) {
    rows.push([row.saleDate, row.name, row.kind === "menu" ? "Menu" : "Item", row.category ?? "", round2(row.qty), round2(row.unitPrice), row.discountPct, round2(row.gross), round2(row.net)]);
  }
  rows.push(["Total", "", "", "", round2(report.totals.qty), "", "", round2(report.totals.gross), round2(report.totals.net)]);
  return toCsv(rows);
}

// ───────────────────────── Purchases ─────────────────────────

export const PURCHASE_HEADERS = ["Date", "Supplier", "Ref", "Item", "Category", "Qty", "Unit cost", "Line total"];

export async function purchaseWorkbook(report: PurchaseReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Purchases", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(ws, "Purchase Report", `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`, PURCHASE_HEADERS.length, meta);
  styleHeaderRow(ws.addRow(PURCHASE_HEADERS));
  for (const row of report.rows) {
    const r = ws.addRow([row.purchaseDate, row.supplier, row.refNo ?? "", row.name, row.category ?? ""]);
    qtyCell(r.getCell(6), row.qty);
    moneyCell(r.getCell(7), row.unitCost, false);
    moneyCell(r.getCell(8), row.lineTotal, false);
  }
  const t = ws.addRow(["Total", "", "", "", ""]);
  t.font = { bold: true };
  qtyCell(t.getCell(6), report.totals.qty);
  moneyCell(t.getCell(8), report.totals.cost, false);

  // Supplier rollup below.
  ws.addRow([]);
  const sh = ws.addRow(["By supplier", "", "", "", "", "Qty", "", "Cost"]);
  styleHeaderRow(sh);
  for (const s of report.bySupplier) {
    const r = ws.addRow([s.supplier, "", "", "", ""]);
    qtyCell(r.getCell(6), s.qty);
    moneyCell(r.getCell(8), s.cost, false);
  }
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 24;
  ws.getColumn(4).width = 30;
  for (const i of [3, 5, 6, 7, 8]) ws.getColumn(i).width = 12;
  return toBuffer(wb);
}

export function purchaseCsv(report: PurchaseReport): string {
  const rows: CsvValue[][] = [PURCHASE_HEADERS];
  for (const row of report.rows) {
    rows.push([row.purchaseDate, row.supplier, row.refNo ?? "", row.name, row.category ?? "", round2(row.qty), round2(row.unitCost), round2(row.lineTotal)]);
  }
  rows.push(["Total", "", "", "", "", round2(report.totals.qty), "", round2(report.totals.cost)]);
  return toCsv(rows);
}

// ───────────────────────── Non-revenue ─────────────────────────

export const NONREV_HEADERS = ["Date", "Item / Menu", "UOM", "Reason", "Qty", "Content/Unit", "Est. Cost", "Est. Retail"];

export async function nonRevenueWorkbook(
  report: NonRevenueReport,
  meta: ReportMeta,
  title = "Non-Revenue Report",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Non-revenue", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(ws, title, `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`, NONREV_HEADERS.length, meta);
  styleHeaderRow(ws.addRow(NONREV_HEADERS));
  for (const row of report.rows) {
    const r = ws.addRow([row.saleDate, row.name, row.uom ?? "", row.reason]);
    qtyCell(r.getCell(5), row.qty);
    r.getCell(6).value = row.contentOverride ?? "";
    r.getCell(6).alignment = { horizontal: "right" };
    if (row.estimatedCost !== null) moneyCell(r.getCell(7), row.estimatedCost, false);
    if (row.estimatedRetail !== null) moneyCell(r.getCell(8), row.estimatedRetail, false);
  }
  const t = ws.addRow(["Total", "", "", ""]);
  t.font = { bold: true };
  qtyCell(t.getCell(5), report.totals.qty);
  moneyCell(t.getCell(7), report.totals.cost, false);
  moneyCell(t.getCell(8), report.totals.retail, false);

  ws.addRow([]);
  const rh = ws.addRow(["By reason", "Count", "Qty", "Est. cost"]);
  styleHeaderRow(rh);
  for (const g of report.byReason) {
    const r = ws.addRow([g.reason, g.count]);
    qtyCell(r.getCell(3), g.qty);
    moneyCell(r.getCell(4), g.cost, false);
  }
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 30;
  for (const i of [3, 4, 5, 6, 7, 8]) ws.getColumn(i).width = 13;
  return toBuffer(wb);
}

export function nonRevenueCsv(report: NonRevenueReport, title = "Non-Revenue Report"): string {
  const rows: CsvValue[][] = [[`${title} · ${report.from} → ${report.to}`], NONREV_HEADERS];
  for (const row of report.rows) {
    rows.push([
      row.saleDate, row.name, row.uom ?? "", row.reason, round2(row.qty), row.contentOverride ?? "",
      row.estimatedCost === null ? "" : round2(row.estimatedCost),
      row.estimatedRetail === null ? "" : round2(row.estimatedRetail),
    ]);
  }
  rows.push(["Total", "", "", "", round2(report.totals.qty), "", round2(report.totals.cost), round2(report.totals.retail)]);
  return toCsv(rows);
}

// ───────────────────────── Inventory on hand ─────────────────────────

export const ONHAND_HEADERS = ["Item", "Category", "Type", "On hand", "Cost", "Retail", "Cost value", "Retail value"];

export async function onHandWorkbook(report: OnHandReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("On hand", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(ws, "Inventory on Hand", `${meta.clientName} · ${meta.locationName} · as of last count ${report.lastCountDate ?? "—"}`, ONHAND_HEADERS.length, meta);
  styleHeaderRow(ws.addRow(ONHAND_HEADERS));
  for (const row of report.rows) {
    const r = ws.addRow([row.name, row.category, row.productType]);
    qtyCell(r.getCell(4), row.onHand, true);
    moneyCell(r.getCell(5), row.cost, false);
    moneyCell(r.getCell(6), row.retail, false);
    moneyCell(r.getCell(7), row.costValue, false);
    moneyCell(r.getCell(8), row.retailValue, false);
  }
  const t = ws.addRow(["Total", "", ""]);
  t.font = { bold: true };
  moneyCell(t.getCell(7), report.totals.costValue, false);
  moneyCell(t.getCell(8), report.totals.retailValue, false);
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 18;
  for (const i of [3, 4, 5, 6, 7, 8]) ws.getColumn(i).width = 13;
  return toBuffer(wb);
}

export function onHandCsv(report: OnHandReport): string {
  const rows: CsvValue[][] = [ONHAND_HEADERS];
  for (const row of report.rows) {
    rows.push([row.name, row.category, row.productType, round2(row.onHand), round2(row.cost), round2(row.retail), round2(row.costValue), round2(row.retailValue)]);
  }
  rows.push(["Total", "", "", "", "", "", round2(report.totals.costValue), round2(report.totals.retailValue)]);
  return toCsv(rows);
}

// ───────────────────────── Cost Analysis ─────────────────────────
// Two-block layout like the legacy CA sheet: sales summary on top, then one
// cost table per product type. Not a flat table — hand-built, not the
// column-spec helper.

const COST_HEADERS = ["Category", "Beginning", "Purchases", "Transfers", "Ending", "Cost", "Cost Net", "GROSS %", "NET %"];

function pctCell(cell: Cell, value: number | null) {
  cell.value = value === null ? "—" : round2(value);
  if (value !== null) cell.numFmt = '0.00"%"';
  cell.alignment = { horizontal: "right" };
}

export async function costAnalysisWorkbook(report: CostAnalysisReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cost Analysis");
  titleBlock(
    ws,
    "Cost Analysis Report",
    `${meta.clientName} · ${meta.locationName} · ${report.begin} → ${report.end} (activity up to, not including, the ending date)`,
    COST_HEADERS.length,
    meta,
  );

  // Sales summary block.
  styleHeaderRow(ws.addRow(["Sales", "Gross", "Net (÷1.12)"]));
  for (const t of report.sales.byType) {
    const r = ws.addRow([`${t.productType} gross sales`]);
    moneyCell(r.getCell(2), t.gross, false);
    moneyCell(r.getCell(3), t.net, false);
  }
  const totalRow = ws.addRow(["Total sales"]);
  totalRow.font = { bold: true };
  moneyCell(totalRow.getCell(2), report.sales.totalGross, false);
  moneyCell(totalRow.getCell(3), report.sales.totalNet, false);
  const vatRow = ws.addRow(["VAT amount (gross − net)"]);
  moneyCell(vatRow.getCell(2), report.sales.vatAmount, false);

  for (const section of report.sections) {
    ws.addRow([]);
    const sh = ws.addRow([`${section.productType.toUpperCase()} COST ANALYSIS — ${meta.clientName}`]);
    sh.font = { bold: true, color: { argb: BLUE } };
    styleHeaderRow(ws.addRow(COST_HEADERS));
    for (const row of section.rows) {
      const r = ws.addRow([row.category]);
      moneyCell(r.getCell(2), row.beginningCost, false);
      moneyCell(r.getCell(3), row.purchasesCost, false);
      moneyCell(r.getCell(4), row.transfersCost);
      moneyCell(r.getCell(5), row.endingCost, false);
      moneyCell(r.getCell(6), row.cost);
      moneyCell(r.getCell(7), row.costNet);
      pctCell(r.getCell(8), row.grossPct);
      pctCell(r.getCell(9), row.netPct);
    }
    const t = ws.addRow(["TOTAL"]);
    t.font = { bold: true };
    moneyCell(t.getCell(2), section.totals.beginningCost, false);
    moneyCell(t.getCell(3), section.totals.purchasesCost, false);
    moneyCell(t.getCell(4), section.totals.transfersCost);
    moneyCell(t.getCell(5), section.totals.endingCost, false);
    moneyCell(t.getCell(6), section.totals.cost);
    moneyCell(t.getCell(7), section.totals.costNet);
    pctCell(t.getCell(8), section.totals.grossPct);
    pctCell(t.getCell(9), section.totals.netPct);
  }

  ws.getColumn(1).width = 28;
  for (let i = 2; i <= COST_HEADERS.length; i++) ws.getColumn(i).width = 13;
  return toBuffer(wb);
}

export function costAnalysisCsv(report: CostAnalysisReport): string {
  const rows: CsvValue[][] = [];
  rows.push(["Sales", "Gross", "Net (/1.12)"]);
  for (const t of report.sales.byType) rows.push([`${t.productType} gross sales`, round2(t.gross), round2(t.net)]);
  rows.push(["Total sales", round2(report.sales.totalGross), round2(report.sales.totalNet)]);
  rows.push(["VAT amount (gross - net)", round2(report.sales.vatAmount)]);
  for (const section of report.sections) {
    rows.push([]);
    rows.push([`${section.productType.toUpperCase()} COST ANALYSIS`]);
    rows.push(COST_HEADERS);
    for (const row of section.rows) {
      rows.push([
        row.category, round2(row.beginningCost), round2(row.purchasesCost), round2(row.transfersCost), round2(row.endingCost),
        round2(row.cost), round2(row.costNet),
        row.grossPct === null ? "" : round2(row.grossPct), row.netPct === null ? "" : round2(row.netPct),
      ]);
    }
    rows.push([
      "TOTAL", round2(section.totals.beginningCost), round2(section.totals.purchasesCost), round2(section.totals.transfersCost), round2(section.totals.endingCost),
      round2(section.totals.cost), round2(section.totals.costNet),
      section.totals.grossPct === null ? "" : round2(section.totals.grossPct),
      section.totals.netPct === null ? "" : round2(section.totals.netPct),
    ]);
  }
  return toCsv(rows);
}

// ───────────────────────── Transfers ─────────────────────────

export const TRANSFER_HEADERS = ["Date", "Location", "Item", "Category", "Sent", "Received", "Unit cost", "At cost", "At retail"];

export async function transferWorkbook(report: TransferReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const title = report.direction === "out" ? "Transfer Out Report" : "Transfer In Report";
  const ws = wb.addWorksheet(report.direction === "out" ? "Transfers out" : "Transfers in", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  titleBlock(ws, title, `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`, TRANSFER_HEADERS.length, meta);
  styleHeaderRow(ws.addRow(TRANSFER_HEADERS));
  for (const row of report.rows) {
    const r = ws.addRow([row.date, row.counterparty, row.name, row.category]);
    qtyCell(r.getCell(5), row.qtySent);
    if (row.qtyReceived === null) {
      r.getCell(6).value = "—"; // dispatched, not yet confirmed by the destination
      r.getCell(6).alignment = { horizontal: "right" };
    } else {
      qtyCell(r.getCell(6), row.qtyReceived, row.qtyReceived < row.qtySent);
    }
    moneyCell(r.getCell(7), row.unitCost, false);
    moneyCell(r.getCell(8), row.costValue, false);
    moneyCell(r.getCell(9), row.retailValue, false);
  }
  const t = ws.addRow(["Total", "", "", ""]);
  t.font = { bold: true };
  qtyCell(t.getCell(report.direction === "out" ? 5 : 6), report.totals.qty);
  moneyCell(t.getCell(8), report.totals.cost, false);
  moneyCell(t.getCell(9), report.totals.retail, false);

  ws.addRow([]);
  const ch = ws.addRow([report.direction === "out" ? "By destination" : "By source", "", "", "", "Qty", "", "", "At cost"]);
  styleHeaderRow(ch);
  for (const g of report.byCounterparty) {
    const r = ws.addRow([g.counterparty, "", "", ""]);
    qtyCell(r.getCell(5), g.qty);
    moneyCell(r.getCell(8), g.cost, false);
  }
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 18;
  for (const i of [5, 6, 7, 8, 9]) ws.getColumn(i).width = 12;
  return toBuffer(wb);
}

export function transferCsv(report: TransferReport): string {
  const rows: CsvValue[][] = [TRANSFER_HEADERS];
  for (const row of report.rows) {
    rows.push([
      row.date, row.counterparty, row.name, row.category,
      round2(row.qtySent), row.qtyReceived === null ? "" : round2(row.qtyReceived),
      round2(row.unitCost), round2(row.costValue), round2(row.retailValue),
    ]);
  }
  rows.push(["Total", "", "", "", report.direction === "out" ? round2(report.totals.qty) : "", report.direction === "in" ? round2(report.totals.qty) : "", "", round2(report.totals.cost), round2(report.totals.retail)]);
  return toCsv(rows);
}

// ───────────────────────── Top Sellers ─────────────────────────
// Three sections in one sheet: Brands, Menus, Ingredients.
// Ingredients omit the Revenue column (consumption has no direct price).

const TOP_BRANDS_HEADERS = ["Rank", "Item", "Category", "Qty", "Revenue"];
const TOP_MENUS_HEADERS = ["Rank", "Menu", "Qty", "Revenue"];
const TOP_INGREDIENTS_HEADERS = ["Rank", "Ingredient", "Category", "Qty consumed"];

export async function topSellersWorkbook(report: TopSellersReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Top Sellers");
  titleBlock(
    ws,
    "Top Sellers Report",
    `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`,
    TOP_BRANDS_HEADERS.length,
    meta,
  );

  // — Top Brands —
  const bh = ws.addRow(["TOP BRANDS"]);
  bh.font = { bold: true, color: { argb: "FF3A56E4" } };
  styleHeaderRow(ws.addRow(TOP_BRANDS_HEADERS));
  report.topBrands.forEach((row, i) => {
    const r = ws.addRow([i + 1, row.name, row.category ?? ""]);
    qtyCell(r.getCell(4), row.qty);
    moneyCell(r.getCell(5), row.revenue, false);
  });
  if (report.topBrands.length === 0) ws.addRow(["—"]);

  ws.addRow([]);

  // — Top Menus —
  const mh = ws.addRow(["TOP MENUS"]);
  mh.font = { bold: true, color: { argb: "FF3A56E4" } };
  styleHeaderRow(ws.addRow(TOP_MENUS_HEADERS));
  report.topMenus.forEach((row, i) => {
    const r = ws.addRow([i + 1, row.name]);
    qtyCell(r.getCell(3), row.qty);
    moneyCell(r.getCell(4), row.revenue, false);
  });
  if (report.topMenus.length === 0) ws.addRow(["—"]);

  ws.addRow([]);

  // — Top Ingredients —
  const ih = ws.addRow(["TOP INGREDIENTS"]);
  ih.font = { bold: true, color: { argb: "FF3A56E4" } };
  styleHeaderRow(ws.addRow(TOP_INGREDIENTS_HEADERS));
  report.topIngredients.forEach((row, i) => {
    const r = ws.addRow([i + 1, row.name, row.category ?? ""]);
    qtyCell(r.getCell(4), row.qty);
  });
  if (report.topIngredients.length === 0) ws.addRow(["—"]);

  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 32;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 13;
  ws.getColumn(5).width = 13;

  return toBuffer(wb);
}

export function topSellersCsv(report: TopSellersReport): string {
  const rows: CsvValue[][] = [];

  rows.push(["TOP BRANDS"]);
  rows.push(TOP_BRANDS_HEADERS);
  report.topBrands.forEach((row, i) =>
    rows.push([i + 1, row.name, row.category ?? "", round2(row.qty), round2(row.revenue)]),
  );

  rows.push([]);
  rows.push(["TOP MENUS"]);
  rows.push(TOP_MENUS_HEADERS);
  report.topMenus.forEach((row, i) =>
    rows.push([i + 1, row.name, round2(row.qty), round2(row.revenue)]),
  );

  rows.push([]);
  rows.push(["TOP INGREDIENTS"]);
  rows.push(TOP_INGREDIENTS_HEADERS);
  report.topIngredients.forEach((row, i) =>
    rows.push([i + 1, row.name, row.category ?? "", round2(row.qty)]),
  );

  return toCsv(rows);
}
