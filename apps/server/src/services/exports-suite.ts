import ExcelJS from "exceljs";
import {
  COST_BASIS_LABELS,
  hasVariance,
  MATERIAL_VARIANCE_PCT,
  round2,
  toCsv,
  varianceSeverity,
  type CostBasis,
  type CsvValue,
  type ReconReport,
  type VarianceSeverity,
} from "@fnb/core";
import {
  brandFooter,
  exportStamp,
  fullAuditColumns,
  moneyCell,
  NONREV_HEADERS,
  ONHAND_HEADERS,
  PURCHASE_HEADERS,
  qtyCell,
  SALES_HEADERS,
  severityFill,
  styleHeaderRow,
  titleBlock,
  toBuffer,
  TRANSFER_HEADERS,
  varianceFlagLabel,
  type ReportMeta,
} from "./exports";
import type { NonRevenueReport, OnHandReport, PurchaseReport, SalesReport, TransferReport } from "./report-lists";
import type {
  CostSnapshotReport,
  ForfeitsReport,
  LegacyAuditReport,
  LegacyAuditRow,
  LegacyAuditTotals,
  LegacyAuditVariant,
  SalesByItemReport,
  UsageCostReport,
} from "./report-suite";
import { tablePdf, type PdfRow } from "./pdf";

/**
 * Client report suite exports (docs/client-report-formats.md): the legacy
 * 24-column audit layout (#1/#2), cost snapshots (#3/#4), forfeits (#5),
 * usage cost (#6), sales by item (#7) — each as XLSX + CSV + PDF — plus PDF
 * renderings for every pre-existing report (the client wants Excel, PDF, or
 * CSV on all of them).
 */

const BLUE = "FF3A56E4";
const LIGHT = "FFEEF1FD";

/** ExcelJS ARGB (e.g. "FFFDECEA") → pdfmake hex ("#FDECEA") for row fills. */
function pdfFill(argb: string): string {
  return `#${argb.slice(2)}`;
}

function stampLine(meta: ReportMeta): string {
  return meta.exportedBy ? `Exported by ${meta.exportedBy} · ${exportStamp()}` : "";
}

// ───────────────── Legacy-layout audit (#1 Detailed / #2 Inventory) ─────────────────

const LEGACY_HEADERS: string[] = [
  "Product Name", "Size/UOM",
  "Begin Full", "Begin Open", "B-Cost",
  "Purchased", "Cost of Purchase", "F",
  "End Full", "End Open", "E-Cost",
  "Usage", "Cost of Usage",
  "Shot", "Bottle", "Cost of Sold", "Revenue",
  "Used vs Sales", "Non Rev Usage", "Non Rev Cost",
  "Over/Short", "%Over/Short", "Cost", "At Retail",
  "Flag",
];

/** 1-based indices of peso columns; the rest of the numbers are quantities. */
const LEGACY_MONEY_COLS = new Set([5, 7, 11, 13, 16, 17, 20, 23, 24]);

/** Over/short materiality of a legacy audit row (client req 2026-07-21) —
    drives both the "Flag" column and the row highlight. Threshold is the
    establishment's saved policy (falls back to the core default). */
function legacyRowSeverity(r: LegacyAuditRow, thresholdPct: number = MATERIAL_VARIANCE_PCT): VarianceSeverity {
  return varianceSeverity(
    { variance: r.overallVariance, variancePct: r.variancePct, contentTracked: r.contentTracked },
    thresholdPct,
  );
}

function legacyRowCells(r: LegacyAuditRow, thresholdPct: number = MATERIAL_VARIANCE_PCT): CsvValue[] {
  return [
    r.productName, r.sizeUom,
    round2(r.beginFull), round2(r.beginOpen), round2(r.bCost),
    round2(r.purchased), round2(r.purchasedCost), round2(r.forfeited),
    round2(r.endFull), round2(r.endOpen), round2(r.eCost),
    round2(r.usage), round2(r.costOfUsage),
    round2(r.shot), round2(r.bottle), round2(r.costOfSold), round2(r.revenue),
    round2(r.usedVsSales), round2(r.nonRevUsage), round2(r.nonRevCost),
    round2(r.overallVariance), r.variancePct === null ? "" : `${Math.round(r.variancePct)}%`,
    round2(r.varianceCost), round2(r.varianceRetail),
    varianceFlagLabel(legacyRowSeverity(r, thresholdPct)),
  ];
}

function legacyTotalCells(label: string, t: LegacyAuditTotals): CsvValue[] {
  return [
    label, "",
    round2(t.beginFull), round2(t.beginOpen), round2(t.bCost),
    round2(t.purchased), round2(t.purchasedCost), round2(t.forfeited),
    round2(t.endFull), round2(t.endOpen), round2(t.eCost),
    round2(t.usage), round2(t.costOfUsage),
    round2(t.shot), round2(t.bottle), round2(t.costOfSold), round2(t.revenue),
    round2(t.usedVsSales), round2(t.nonRevUsage), round2(t.nonRevCost),
    round2(t.overallVariance), "",
    round2(t.varianceCost), round2(t.varianceRetail),
    "",
  ];
}

export function legacyAuditTitle(variant: LegacyAuditVariant): string {
  return variant === "detailed" ? "Detailed Full Audit Report" : "Inventory Report";
}

function legacyRatioLabel(variant: LegacyAuditVariant): string {
  return variant === "detailed"
    ? "Cost Ratio (cost of sold / revenue)"
    : "Cost Ratio (cost of usage / revenue)";
}

export async function legacyAuditWorkbook(
  report: LegacyAuditReport,
  meta: ReportMeta,
  variant: LegacyAuditVariant,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(legacyAuditTitle(variant).slice(0, 28), { views: [{ state: "frozen", ySplit: 5 }] });

  // Hand-rolled title block: the headline cost ratio sits top-right, exactly
  // like the client's sample files.
  ws.mergeCells("A1:R1");
  ws.getCell("A1").value = legacyAuditTitle(variant);
  ws.getCell("A1").font = { bold: true, size: 15, color: { argb: BLUE } };
  ws.mergeCells("A2:R2");
  ws.getCell("A2").value =
    `${meta.clientName} · ${meta.locationName} · ${report.begin} → ${report.end} (activity up to, not including, the ending date) · Valuation: ${COST_BASIS_LABELS[report.costBasis]}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };
  ws.getCell("S1").value = legacyRatioLabel(variant);
  ws.getCell("S1").font = { bold: true, size: 10 };
  ws.getCell("W1").value = report.costRatio === null ? "—" : round2(report.costRatio);
  ws.getCell("W1").font = { bold: true, size: 12, color: { argb: BLUE } };
  ws.addRow([]);
  brandFooter(ws, meta);

  // Two-row header with merged group spans (rows 4-5).
  const groupRow = ws.addRow([
    "Product Name", "Size/UOM", "Beginning Inventory", "", "B-Cost", "Purchased", "Cost of Purchase", "F",
    "Ending Inventory", "", "E-Cost", "USAGE", "Cost of Usage", "SALES", "", "Cost of Sold", "Revenue",
    "Variance", "Non Rev", "Non Rev", "Overall Variance", "", "", "", "Flag",
  ]);
  const subRow = ws.addRow([
    "", "", "Full", "Open", "", "", "", "", "Full", "Open", "", "", "",
    "Shot", "Bottle", "", "", "Used vs Sales", "Usage", "Cost", "Over/Short", "%Over/Short", "Cost", "At Retail", "",
  ]);
  for (const range of [
    "A4:A5", "B4:B5", "C4:D4", "E4:E5", "F4:F5", "G4:G5", "H4:H5", "I4:J4",
    "K4:K5", "L4:L5", "M4:M5", "N4:O4", "P4:P5", "Q4:Q5", "R4:R5", "U4:X4", "Y4:Y5",
  ]) {
    ws.mergeCells(range);
  }
  styleHeaderRow(groupRow);
  styleHeaderRow(subRow);
  groupRow.alignment = { horizontal: "center", vertical: "middle" };

  const writeCells = (cells: CsvValue[], row: ExcelJS.Row) => {
    cells.forEach((value, i) => {
      const cell = row.getCell(i + 1);
      if (typeof value === "number") {
        if (LEGACY_MONEY_COLS.has(i + 1)) moneyCell(cell, value);
        else qtyCell(cell, value, true);
      } else {
        cell.value = value;
      }
    });
  };

  const threshold = meta.varianceThresholdPct ?? MATERIAL_VARIANCE_PCT;
  for (const group of report.groups) {
    for (const r of group.rows) {
      const dataRow = ws.addRow([]);
      writeCells(legacyRowCells(r, threshold), dataRow);
      // Highlight a material over/short row (client req 2026-07-21) — the same
      // rule and colours as the on-screen Full Audit.
      const fill = severityFill(legacyRowSeverity(r, threshold));
      if (fill) dataRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } }; });
    }
    const totalRow = ws.addRow([]);
    writeCells(legacyTotalCells(`${group.categoryName.toUpperCase()} TOTAL`, group.totals), totalRow);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    });
    ws.addRow([]);
  }
  const grand = ws.addRow([]);
  writeCells(legacyTotalCells("GRAND TOTAL", report.totals), grand);
  grand.font = { bold: true };
  grand.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
  });

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 10;
  for (let c = 3; c <= 24; c++) ws.getColumn(c).width = 11;
  ws.getColumn(25).width = 8;
  return toBuffer(wb);
}

export function legacyAuditCsv(
  report: LegacyAuditReport,
  variant: LegacyAuditVariant,
  thresholdPct: number = MATERIAL_VARIANCE_PCT,
): string {
  const rows: CsvValue[][] = [
    [`${legacyAuditTitle(variant)} · ${report.begin} → ${report.end} · Valuation: ${COST_BASIS_LABELS[report.costBasis]}`],
    [legacyRatioLabel(variant), report.costRatio === null ? "" : round2(report.costRatio)],
    LEGACY_HEADERS,
  ];
  for (const group of report.groups) {
    for (const r of group.rows) rows.push(legacyRowCells(r, thresholdPct));
    rows.push(legacyTotalCells(`${group.categoryName.toUpperCase()} TOTAL`, group.totals));
    rows.push([]);
  }
  rows.push(legacyTotalCells("GRAND TOTAL", report.totals));
  return toCsv(rows);
}

export function legacyAuditPdf(
  report: LegacyAuditReport,
  meta: ReportMeta,
  variant: LegacyAuditVariant,
): Promise<Buffer> {
  const threshold = meta.varianceThresholdPct ?? MATERIAL_VARIANCE_PCT;
  const rows: PdfRow[] = [];
  for (const group of report.groups) {
    for (const r of group.rows) {
      const fill = severityFill(legacyRowSeverity(r, threshold));
      rows.push({
        cells: legacyRowCells(r, threshold) as (string | number)[],
        ...(fill ? { fill: pdfFill(fill) } : {}),
      });
    }
    rows.push({
      cells: legacyTotalCells(`${group.categoryName.toUpperCase()} TOTAL`, group.totals) as (string | number)[],
      kind: "total",
    });
  }
  rows.push({ cells: legacyTotalCells("GRAND TOTAL", report.totals) as (string | number)[], kind: "total" });
  return tablePdf({
    title: legacyAuditTitle(variant),
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.begin} → ${report.end} · ${legacyRatioLabel(variant)}: ${report.costRatio === null ? "—" : round2(report.costRatio)} · Valuation: ${COST_BASIS_LABELS[report.costBasis]}`,
    columns: LEGACY_HEADERS.map((h, i) => ({ header: h, align: i < 2 ? "left" : "right", width: i === 0 ? "*" : "auto" })),
    rows,
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
    landscape: true,
  });
}

// ───────────────── Cost snapshots (#3 Beginning / #4 Ending) ─────────────────

const SNAPSHOT_HEADERS = ["Item", "UOM", "Qty", "Cost Price (PHP)", "Value (PHP)", "Cost Basis"];

/** In-file disclosure of the valuation policy — two files with the same title
    and different totals must be self-describing, not just differently named. */
function basisNote(basis: CostBasis): string {
  return basis === "AVERAGE"
    ? "Cost basis: weighted average — (opening stock + purchases) ÷ total units, as of the report date"
    : "Cost basis: purchase price — the cost recorded on the count line";
}

function snapshotRowCells(report: CostSnapshotReport): CsvValue[][] {
  return report.rows.map((r) => [
    r.name,
    r.uom,
    r.qty,
    r.cost,
    r.value,
    r.basis === "average" ? "Avg purchase" : "Cost price",
  ]);
}

export async function costSnapshotWorkbook(
  report: CostSnapshotReport,
  meta: ReportMeta,
  side: "Beginning" | "Ending",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${side} Cost`, { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(
    ws,
    `${side} Cost Report`,
    `${meta.clientName} · ${meta.locationName} · as of count ${report.anchorDate} · ${basisNote(report.costBasis)}`,
    SNAPSHOT_HEADERS.length,
    meta,
  );
  styleHeaderRow(ws.addRow(SNAPSHOT_HEADERS));
  for (const r of report.rows) {
    const row = ws.addRow([r.name, r.uom]);
    qtyCell(row.getCell(3), r.qty);
    moneyCell(row.getCell(4), r.cost, false);
    moneyCell(row.getCell(5), r.value, false);
    row.getCell(6).value = r.basis === "average" ? "Avg purchase" : "Cost price";
  }
  const t = ws.addRow(["Grand Total", ""]);
  qtyCell(t.getCell(3), report.totals.qty);
  moneyCell(t.getCell(5), report.totals.value, false);
  t.font = { bold: true };
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 12;
  for (let c = 3; c <= 6; c++) ws.getColumn(c).width = 16;
  return toBuffer(wb);
}

export function costSnapshotCsv(report: CostSnapshotReport, side: "Beginning" | "Ending"): string {
  return toCsv([
    [`${side} Cost Report · as of count ${report.anchorDate}`],
    [basisNote(report.costBasis)],
    SNAPSHOT_HEADERS,
    ...snapshotRowCells(report),
    ["Grand Total", "", report.totals.qty, "", report.totals.value, ""],
  ]);
}

export function costSnapshotPdf(
  report: CostSnapshotReport,
  meta: ReportMeta,
  side: "Beginning" | "Ending",
): Promise<Buffer> {
  return tablePdf({
    title: `${side} Cost Report`,
    subtitle: `${meta.clientName} · ${meta.locationName} · as of count ${report.anchorDate} · ${basisNote(report.costBasis)}`,
    columns: SNAPSHOT_HEADERS.map((h, i) => ({ header: h, align: i < 2 ? "left" : "right", width: i === 0 ? "*" : "auto" })),
    rows: [
      ...snapshotRowCells(report).map((cells) => ({ cells: cells as (string | number)[] })),
      { cells: ["Grand Total", "", report.totals.qty, "", report.totals.value, ""], kind: "total" as const },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

// ───────────────── Forfeited Bottles (#5) ─────────────────

const FORFEIT_HEADERS = ["Date", "Item", "UOM", "Qty", "Open Content (Units)", "At Cost (PHP)", "At Retail (PHP)"];

function forfeitRowCells(report: ForfeitsReport): CsvValue[][] {
  return report.rows.map((r) => [r.date, r.name, r.uom, r.qty, r.contentEquiv, r.costValue, r.retailValue]);
}

export async function forfeitsWorkbook(report: ForfeitsReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Forfeited Bottles", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(
    ws,
    "Forfeited Bottles Report",
    `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`,
    FORFEIT_HEADERS.length,
    meta,
  );
  styleHeaderRow(ws.addRow(FORFEIT_HEADERS));
  for (const r of report.rows) {
    const row = ws.addRow([r.date, r.name, r.uom]);
    qtyCell(row.getCell(4), r.qty);
    qtyCell(row.getCell(5), r.contentEquiv);
    moneyCell(row.getCell(6), r.costValue, false);
    moneyCell(row.getCell(7), r.retailValue, false);
  }
  const t = ws.addRow(["Grand Total", "", ""]);
  qtyCell(t.getCell(4), report.totals.qty);
  qtyCell(t.getCell(5), report.totals.contentEquiv);
  moneyCell(t.getCell(6), report.totals.costValue, false);
  moneyCell(t.getCell(7), report.totals.retailValue, false);
  t.font = { bold: true };
  ws.getColumn(2).width = 34;
  for (const c of [1, 3, 4, 5, 6, 7]) ws.getColumn(c).width = 14;
  return toBuffer(wb);
}

export function forfeitsCsv(report: ForfeitsReport): string {
  return toCsv([
    [`Forfeited Bottles Report · ${report.from} → ${report.to}`],
    FORFEIT_HEADERS,
    ...forfeitRowCells(report),
    ["Grand Total", "", "", report.totals.qty, report.totals.contentEquiv, report.totals.costValue, report.totals.retailValue],
  ]);
}

export function forfeitsPdf(report: ForfeitsReport, meta: ReportMeta): Promise<Buffer> {
  return tablePdf({
    title: "Forfeited Bottles Report",
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`,
    columns: FORFEIT_HEADERS.map((h, i) => ({ header: h, align: i < 3 ? "left" : "right", width: i === 1 ? "*" : "auto" })),
    rows: [
      ...forfeitRowCells(report).map((cells) => ({ cells: cells as (string | number)[] })),
      {
        cells: ["Grand Total", "", "", report.totals.qty, report.totals.contentEquiv, report.totals.costValue, report.totals.retailValue],
        kind: "total" as const,
      },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

// ───────────────── Usage Cost (#6) ─────────────────

const USAGE_HEADERS = ["Item", "UOM", "Qty Used", "Cost (PHP)"];

export async function usageCostWorkbook(report: UsageCostReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Usage Cost", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(
    ws,
    "Usage Cost Report",
    `${meta.clientName} · ${meta.locationName} · ${report.begin} → ${report.end} (activity up to, not including, the ending date)`,
    USAGE_HEADERS.length,
    meta,
  );
  styleHeaderRow(ws.addRow(USAGE_HEADERS));
  for (const r of report.rows) {
    const row = ws.addRow([r.name, r.uom]);
    qtyCell(row.getCell(3), r.qty, true);
    moneyCell(row.getCell(4), r.cost);
  }
  const t = ws.addRow(["Grand Total", ""]);
  qtyCell(t.getCell(3), report.totals.qty, true);
  moneyCell(t.getCell(4), report.totals.cost);
  t.font = { bold: true };
  ws.getColumn(1).width = 34;
  for (const c of [2, 3, 4]) ws.getColumn(c).width = 15;
  return toBuffer(wb);
}

export function usageCostCsv(report: UsageCostReport): string {
  return toCsv([
    [`Usage Cost Report · ${report.begin} → ${report.end}`],
    USAGE_HEADERS,
    ...report.rows.map((r): CsvValue[] => [r.name, r.uom, r.qty, r.cost]),
    ["Grand Total", "", report.totals.qty, report.totals.cost],
  ]);
}

export function usageCostPdf(report: UsageCostReport, meta: ReportMeta): Promise<Buffer> {
  return tablePdf({
    title: "Usage Cost Report",
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.begin} → ${report.end}`,
    columns: USAGE_HEADERS.map((h, i) => ({ header: h, align: i < 2 ? "left" : "right", width: i === 0 ? "*" : "auto" })),
    rows: [
      ...report.rows.map((r) => ({ cells: [r.name, r.uom, r.qty, r.cost] as (string | number)[] })),
      { cells: ["Grand Total", "", report.totals.qty, report.totals.cost], kind: "total" as const },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

// ───────────────── Sales by Item — shot & bottle (#7) ─────────────────

const SALES_ITEM_HEADERS = ["Item", "UOM", "Shot", "Bottle", "Total Qty", "Cost of Sold (PHP)", "Revenue (PHP)"];

export async function salesByItemWorkbook(report: SalesByItemReport, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales by Item", { views: [{ state: "frozen", ySplit: 4 }] });
  titleBlock(
    ws,
    "Sales Report (Shot & Bottle)",
    `${meta.clientName} · ${meta.locationName} · ${report.begin} → ${report.end} (activity up to, not including, the ending date)`,
    SALES_ITEM_HEADERS.length,
    meta,
  );
  styleHeaderRow(ws.addRow(SALES_ITEM_HEADERS));
  for (const r of report.rows) {
    const row = ws.addRow([r.name, r.uom]);
    qtyCell(row.getCell(3), r.shot);
    qtyCell(row.getCell(4), r.bottle);
    qtyCell(row.getCell(5), r.qty);
    moneyCell(row.getCell(6), r.cost, false);
    moneyCell(row.getCell(7), r.retail, false);
  }
  const t = ws.addRow(["Grand Total", ""]);
  qtyCell(t.getCell(3), report.totals.shot);
  qtyCell(t.getCell(4), report.totals.bottle);
  qtyCell(t.getCell(5), report.totals.qty);
  moneyCell(t.getCell(6), report.totals.cost, false);
  moneyCell(t.getCell(7), report.totals.retail, false);
  t.font = { bold: true };
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= 7; c++) ws.getColumn(c).width = 14;
  return toBuffer(wb);
}

export function salesByItemCsv(report: SalesByItemReport): string {
  return toCsv([
    [`Sales Report (Shot & Bottle) · ${report.begin} → ${report.end}`],
    SALES_ITEM_HEADERS,
    ...report.rows.map((r): CsvValue[] => [r.name, r.uom, r.shot, r.bottle, r.qty, r.cost, r.retail]),
    ["Grand Total", "", report.totals.shot, report.totals.bottle, report.totals.qty, report.totals.cost, report.totals.retail],
  ]);
}

export function salesByItemPdf(report: SalesByItemReport, meta: ReportMeta): Promise<Buffer> {
  return tablePdf({
    title: "Sales Report (Shot & Bottle)",
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.begin} → ${report.end}`,
    columns: SALES_ITEM_HEADERS.map((h, i) => ({ header: h, align: i < 2 ? "left" : "right", width: i === 0 ? "*" : "auto" })),
    rows: [
      ...report.rows.map((r) => ({
        cells: [r.name, r.uom, r.shot, r.bottle, r.qty, r.cost, r.retail] as (string | number)[],
      })),
      {
        cells: ["Grand Total", "", report.totals.shot, report.totals.bottle, report.totals.qty, report.totals.cost, report.totals.retail],
        kind: "total" as const,
      },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

// ───────────────── PDF renderings for the pre-existing reports ─────────────────

export function salesPdfDoc(report: SalesReport, meta: ReportMeta, title = "Sales Report"): Promise<Buffer> {
  return tablePdf({
    title,
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`,
    columns: SALES_HEADERS.map((h, i) => ({ header: String(h), align: i < 4 ? "left" : "right", width: i === 1 ? "*" : "auto" })),
    rows: [
      ...report.rows.map((r) => ({
        cells: [
          r.saleDate, r.name, r.kind === "menu" ? "Menu" : "Item", r.category ?? "",
          round2(r.qty), round2(r.unitPrice), r.discountPct || 0, round2(r.gross), round2(r.net),
        ] as (string | number)[],
      })),
      {
        cells: ["Total", "", "", "", round2(report.totals.qty), "", "", round2(report.totals.gross), round2(report.totals.net)],
        kind: "total" as const,
      },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

export function purchasePdfDoc(report: PurchaseReport, meta: ReportMeta): Promise<Buffer> {
  return tablePdf({
    title: "Purchase Report",
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`,
    columns: PURCHASE_HEADERS.map((h, i) => ({ header: String(h), align: i < 5 ? "left" : "right", width: i === 3 ? "*" : "auto" })),
    rows: [
      ...report.rows.map((r) => ({
        cells: [r.purchaseDate, r.supplier, r.refNo ?? "", r.name, r.category ?? "", round2(r.qty), round2(r.unitCost), round2(r.lineTotal)] as (string | number)[],
      })),
      { cells: ["Total", "", "", "", "", round2(report.totals.qty), "", round2(report.totals.cost)], kind: "total" as const },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

export function nonRevenuePdfDoc(report: NonRevenueReport, meta: ReportMeta, title = "Non-Revenue Report"): Promise<Buffer> {
  return tablePdf({
    title,
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`,
    columns: NONREV_HEADERS.map((h, i) => ({ header: String(h), align: i < 4 ? "left" : "right", width: i === 1 ? "*" : "auto" })),
    rows: [
      ...report.rows.map((r) => ({
        cells: [
          r.saleDate, r.name, r.uom ?? "", r.reason, round2(r.qty), r.contentOverride ?? "",
          r.estimatedCost === null ? "" : round2(r.estimatedCost),
          r.estimatedRetail === null ? "" : round2(r.estimatedRetail),
        ] as (string | number)[],
      })),
      {
        cells: ["Total", "", "", "", round2(report.totals.qty), "", round2(report.totals.cost), round2(report.totals.retail)],
        kind: "total" as const,
      },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

export function transferPdfDoc(report: TransferReport, meta: ReportMeta, direction: "in" | "out"): Promise<Buffer> {
  return tablePdf({
    title: direction === "out" ? "Transfer Out Report" : "Transfer In Report",
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.from} → ${report.to}`,
    columns: TRANSFER_HEADERS.map((h, i) => ({ header: String(h), align: i < 4 ? "left" : "right", width: i === 2 ? "*" : "auto" })),
    rows: [
      ...report.rows.map((r) => ({
        cells: [
          r.date, r.counterparty, r.name, r.category,
          round2(r.qtySent), r.qtyReceived === null ? "—" : round2(r.qtyReceived),
          round2(r.unitCost), round2(r.costValue), round2(r.retailValue),
        ] as (string | number)[],
      })),
      {
        cells: ["Total", "", "", "", round2(report.totals.qty), "", "", round2(report.totals.cost), round2(report.totals.retail)],
        kind: "total" as const,
      },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

export function onHandPdfDoc(report: OnHandReport, meta: ReportMeta): Promise<Buffer> {
  return tablePdf({
    title: "Inventory on Hand",
    subtitle: `${meta.clientName} · ${meta.locationName} · as of last count ${report.lastCountDate ?? "—"}`,
    columns: ONHAND_HEADERS.map((h, i) => ({ header: String(h), align: i < 3 ? "left" : "right", width: i === 0 ? "*" : "auto" })),
    rows: [
      ...report.rows.map((r) => ({
        cells: [r.name, r.category, r.productType, round2(r.onHand), round2(r.cost), round2(r.retail), round2(r.costValue), round2(r.retailValue)] as (string | number)[],
      })),
      {
        cells: ["Total Valuation", "", "", "", "", "", round2(report.totals.costValue), round2(report.totals.retailValue)],
        kind: "total" as const,
      },
    ],
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
  });
}

export function fullAuditPdfDoc(report: ReconReport, meta: ReportMeta, varianceOnly = false): Promise<Buffer> {
  const threshold = meta.varianceThresholdPct ?? MATERIAL_VARIANCE_PCT;
  const columns = fullAuditColumns(threshold);
  const rows: PdfRow[] = [];
  for (const group of report.categories) {
    const groupRows = varianceOnly ? group.rows.filter((r) => hasVariance(r.variance)) : group.rows;
    if (groupRows.length === 0) continue;
    rows.push({ cells: [group.categoryName.toUpperCase()], kind: "group" });
    for (const r of groupRows) {
      const fill = severityFill(varianceSeverity(r, threshold));
      rows.push({
        cells: [
          r.itemName,
          ...columns.map((c) => {
            const v = c.value(r);
            return v === null ? "—" : typeof v === "string" ? v : round2(v);
          }),
        ] as (string | number)[],
        ...(fill ? { fill: pdfFill(fill) } : {}),
      });
    }
  }
  const totalCells: (string | number)[] = [varianceOnly ? "Variance Total" : "Grand Total"];
  for (const c of columns) totalCells.push(c.total ? round2(c.total(report.totals)) : "");
  rows.push({ cells: totalCells, kind: "total" });
  return tablePdf({
    title: varianceOnly ? "Variance Report" : "Full Audit Report",
    subtitle: `${meta.clientName} · ${meta.locationName} · ${report.period.beginDate} → ${report.period.endDate} (activity up to, not including, the ending date)`,
    columns: [
      { header: "Item", align: "left", width: "*" },
      ...columns.map((c) => ({ header: c.header, align: "right" as const, width: "auto" as const })),
    ],
    rows,
    exportedBy: stampLine(meta),
    reportFooter: meta.footer,
    landscape: true,
  });
}
