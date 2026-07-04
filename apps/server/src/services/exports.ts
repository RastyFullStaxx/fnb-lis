import ExcelJS from "exceljs";
import { round2, toCsv, type CsvValue, type ReconReport } from "@fnb/core";
import type { NonRevenueReport, OnHandReport, PurchaseReport, SalesReport } from "./report-lists";

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
}

type Cell = ExcelJS.Cell;

/** Branded print footer — company on the left, generated note on the right.
 *  Set on the sheet's headerFooter so it never disturbs the on-sheet layout. */
function brandFooter(ws: ExcelJS.Worksheet, meta: ReportMeta) {
  const left = [meta.legalName || meta.clientName, meta.address].filter(Boolean).join(" · ");
  const right = meta.footer || "Prepared with Liquor Inventory Solution";
  ws.headerFooter.oddFooter = `&L&8${left}&R&8${right}`;
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: WHITE } };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    cell.alignment = { vertical: "middle" };
  });
}

function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, colCount: number, meta: ReportMeta) {
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

function moneyCell(cell: Cell, value: number, negativeRed = true) {
  cell.value = round2(value);
  cell.numFmt = MONEY;
  cell.alignment = { horizontal: "right" };
  if (negativeRed && value < 0) cell.font = { color: { argb: RED } };
}

function qtyCell(cell: Cell, value: number, negativeRed = false) {
  cell.value = round2(value);
  cell.numFmt = QTY;
  cell.alignment = { horizontal: "right" };
  if (negativeRed && value < 0) cell.font = { color: { argb: RED } };
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  wb.creator = "Liquor Inventory Solution";
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

// ───────────────────────── Full Audit ─────────────────────────

const FULL_AUDIT_HEADERS = [
  "Item", "Begin full", "Begin open", "Purchased", "Returns", "End full", "End open",
  "Usage", "Sold direct", "Sold recipe", "Non-rev", "Production", "Revenue", "Variance",
  "%", "At cost", "At retail",
];

export async function fullAuditWorkbook(report: ReconReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Full Audit", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });

  titleBlock(
    ws,
    "Full Audit Report",
    `${meta.clientName} · ${meta.locationName} · ${report.period.beginDate} → ${report.period.endDate} (activity up to, not including, the ending date)`,
    FULL_AUDIT_HEADERS.length,
    meta,
  );
  styleHeaderRow(ws.addRow(FULL_AUDIT_HEADERS));

  for (const group of report.categories) {
    const groupRow = ws.addRow([group.categoryName]);
    groupRow.font = { bold: true };
    groupRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    });
    for (const row of group.rows) {
      const r = ws.addRow([row.itemName]);
      qtyCell(r.getCell(2), row.beginFull);
      qtyCell(r.getCell(3), row.beginOpenEquiv);
      qtyCell(r.getCell(4), row.purchased);
      qtyCell(r.getCell(5), row.forfeited);
      qtyCell(r.getCell(6), row.endFull);
      qtyCell(r.getCell(7), row.endOpenEquiv);
      qtyCell(r.getCell(8), row.usage);
      qtyCell(r.getCell(9), row.soldDirect);
      qtyCell(r.getCell(10), row.soldPortion);
      qtyCell(r.getCell(11), row.nonRevenue);
      qtyCell(r.getCell(12), row.production);
      moneyCell(r.getCell(13), row.revenue, false);
      qtyCell(r.getCell(14), row.variance, true);
      const pct = r.getCell(15);
      pct.value = row.variancePct === null ? "—" : round2(row.variancePct);
      if (row.variancePct !== null) pct.numFmt = '0.00"%"';
      pct.alignment = { horizontal: "right" };
      if (row.variancePct !== null && row.variancePct < 0) pct.font = { color: { argb: RED } };
      moneyCell(r.getCell(16), row.varianceCost);
      moneyCell(r.getCell(17), row.varianceRetail);
    }
  }

  const totalRow = ws.addRow(["Grand total"]);
  totalRow.font = { bold: true };
  moneyCell(totalRow.getCell(13), report.totals.revenue, false);
  totalRow.getCell(13).font = { bold: true };
  const INK = "FF111827";
  moneyCell(totalRow.getCell(16), report.totals.varianceCost);
  totalRow.getCell(16).font = { bold: true, color: { argb: report.totals.varianceCost < 0 ? RED : INK } };
  moneyCell(totalRow.getCell(17), report.totals.varianceRetail);
  totalRow.getCell(17).font = { bold: true, color: { argb: report.totals.varianceRetail < 0 ? RED : INK } };

  ws.getColumn(1).width = 30;
  for (let i = 2; i <= FULL_AUDIT_HEADERS.length; i++) ws.getColumn(i).width = 11;

  return toBuffer(wb);
}

export function fullAuditCsv(report: ReconReport): string {
  const rows: CsvValue[][] = [FULL_AUDIT_HEADERS];
  for (const group of report.categories) {
    rows.push([group.categoryName]);
    for (const row of group.rows) {
      rows.push([
        row.itemName, round2(row.beginFull), round2(row.beginOpenEquiv), round2(row.purchased),
        round2(row.forfeited), round2(row.endFull), round2(row.endOpenEquiv), round2(row.usage),
        round2(row.soldDirect), round2(row.soldPortion), round2(row.nonRevenue), round2(row.production),
        round2(row.revenue), round2(row.variance),
        row.variancePct === null ? "" : round2(row.variancePct), round2(row.varianceCost), round2(row.varianceRetail),
      ]);
    }
  }
  rows.push(["Grand total", "", "", "", "", "", "", "", "", "", "", "", round2(report.totals.revenue), "", "", round2(report.totals.varianceCost), round2(report.totals.varianceRetail)]);
  return toCsv(rows);
}

// ───────────────────────── Sales ─────────────────────────

const SALES_HEADERS = ["Date", "Item / Menu", "Type", "Category", "Qty", "Unit price", "Discount %", "Gross", "Net"];

export async function salesWorkbook(report: SalesReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(ws, "Sales Report", `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`, SALES_HEADERS.length, meta);
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

export function salesCsv(report: SalesReport): string {
  const rows: CsvValue[][] = [SALES_HEADERS];
  for (const row of report.rows) {
    rows.push([row.saleDate, row.name, row.kind === "menu" ? "Menu" : "Item", row.category ?? "", round2(row.qty), round2(row.unitPrice), row.discountPct, round2(row.gross), round2(row.net)]);
  }
  rows.push(["Total", "", "", "", round2(report.totals.qty), "", "", round2(report.totals.gross), round2(report.totals.net)]);
  return toCsv(rows);
}

// ───────────────────────── Purchases ─────────────────────────

const PURCHASE_HEADERS = ["Date", "Supplier", "Ref", "Item", "Category", "Qty", "Unit cost", "Line total"];

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

const NONREV_HEADERS = ["Date", "Item / Menu", "Reason", "Qty", "Content/unit", "Est. cost"];

export async function nonRevenueWorkbook(report: NonRevenueReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Non-revenue", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(ws, "Non-Revenue Report", `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`, NONREV_HEADERS.length, meta);
  styleHeaderRow(ws.addRow(NONREV_HEADERS));
  for (const row of report.rows) {
    const r = ws.addRow([row.saleDate, row.name, row.reason]);
    qtyCell(r.getCell(4), row.qty);
    r.getCell(5).value = row.contentOverride ?? "";
    r.getCell(5).alignment = { horizontal: "right" };
    if (row.estimatedCost !== null) moneyCell(r.getCell(6), row.estimatedCost, false);
  }
  const t = ws.addRow(["Total", "", ""]);
  t.font = { bold: true };
  qtyCell(t.getCell(4), report.totals.qty);
  moneyCell(t.getCell(6), report.totals.cost, false);

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
  for (const i of [3, 4, 5, 6]) ws.getColumn(i).width = 13;
  return toBuffer(wb);
}

export function nonRevenueCsv(report: NonRevenueReport): string {
  const rows: CsvValue[][] = [NONREV_HEADERS];
  for (const row of report.rows) {
    rows.push([row.saleDate, row.name, row.reason, round2(row.qty), row.contentOverride ?? "", row.estimatedCost === null ? "" : round2(row.estimatedCost)]);
  }
  rows.push(["Total", "", "", round2(report.totals.qty), "", round2(report.totals.cost)]);
  return toCsv(rows);
}

// ───────────────────────── Inventory on hand ─────────────────────────

const ONHAND_HEADERS = ["Item", "Category", "Type", "On hand", "Cost", "Retail", "Cost value", "Retail value"];

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
