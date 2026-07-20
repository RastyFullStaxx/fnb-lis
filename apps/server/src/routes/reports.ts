import { Hono, type Context } from "hono";
import {
  allowedProductTypes,
  COST_BASIS_LABELS,
  COST_BASIS_SLUGS,
  isCostBasis,
  NON_REVENUE_GROUP_LABELS,
  NON_REVENUE_GROUPS,
  type CostBasis,
  type NonRevenueGroup,
} from "@fnb/core";
import { AppError } from "../lib/errors";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { buildFullAudit, committedCountDates } from "../services/report-assembly";
import {
  costAnalysisReport,
  fullAuditDrill,
  nonRevenueReport,
  onHandReport,
  purchaseReport,
  salesReport,
  transferReport,
  type SalesReportView,
} from "../services/report-lists";
import { topSellersReport } from "../services/top-sellers";
import {
  costAnalysisCsv,
  costAnalysisWorkbook,
  fullAuditCsv,
  fullAuditWorkbook,
  nonRevenueCsv,
  nonRevenueWorkbook,
  onHandCsv,
  onHandWorkbook,
  purchaseCsv,
  purchaseWorkbook,
  salesCsv,
  salesWorkbook,
  topSellersCsv,
  topSellersWorkbook,
  transferCsv,
  transferWorkbook,
  exportStamp,
  type ReportMeta,
} from "../services/exports";
import { getCompanyInfo } from "./settings";
import {
  costSnapshotReport,
  forfeitsReport,
  legacyAuditReport,
  salesByItemReport,
  usageCostReport,
  type LegacyAuditVariant,
} from "../services/report-suite";
import {
  costSnapshotCsv,
  costSnapshotPdf,
  costSnapshotWorkbook,
  forfeitsCsv,
  forfeitsPdf,
  forfeitsWorkbook,
  fullAuditPdfDoc,
  legacyAuditCsv,
  legacyAuditPdf,
  legacyAuditTitle,
  legacyAuditWorkbook,
  nonRevenuePdfDoc,
  onHandPdfDoc,
  purchasePdfDoc,
  salesByItemCsv,
  salesByItemPdf,
  salesByItemWorkbook,
  salesPdfDoc,
  transferPdfDoc,
  usageCostCsv,
  usageCostPdf,
  usageCostWorkbook,
} from "../services/exports-suite";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const exportGuard = requirePermission("reports.export");

/** Whitelist ?view= for the sales report; anything else means the default. */
function salesView(raw: string | undefined): SalesReportView {
  return raw === "discounted" || raw === "production" ? raw : "sales";
}

/** Whitelist ?group= for the non-revenue report; unknown values mean "all". */
function nrGroup(raw: string | undefined): NonRevenueGroup | undefined {
  return (NON_REVENUE_GROUPS as readonly string[]).includes(raw ?? "") ? (raw as NonRevenueGroup) : undefined;
}

/**
 * The client's saved inventory cost basis — an accounting policy, never a
 * query parameter: two people exporting the same report must not be able to
 * produce different totals. Applies to VALUATION only (see @fnb/core
 * COST_BASES); variance cost is basis-independent by design.
 */
function basisOf(c: Context<AppEnv>): CostBasis {
  const raw = (c.get("client") as { costBasis?: string } | undefined)?.costBasis;
  return isCostBasis(raw) ? raw : "PRICE";
}

/** Only a non-default basis is stamped into filenames — a "purchase-price"
    suffix on every legacy file would be noise. */
function basisSuffix(basis: CostBasis): string {
  return basis === "PRICE" ? "" : `_${COST_BASIS_SLUGS[basis]}`;
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}

function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}

function csvResponse(text: string, filename: string, exportedBy?: string): Response {
  // Traceability trailer — same fact the xlsx print footer carries.
  const trailer = exportedBy ? `\r\n"Exported by ${exportedBy.replace(/"/g, '""')} · ${exportStamp()}"` : "";
  return new Response(text + trailer, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}

function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function requireRange(c: { req: { query: (k: string) => string | undefined } }): { from: string; to: string } {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new AppError(400, "from and to must be YYYY-MM-DD");
  if (to < from) throw new AppError(400, "The end date must be on or after the start date");
  return { from, to };
}

export const reportRoutes = new Hono<AppEnv>()
  .use(requirePermission("reports.view"))

  .get("/reports/count-dates", async (c) => {
    const location = c.get("location");
    return c.json({ dates: await committedCountDates(location.id) });
  })

  // ── Full Audit ──
  .get("/reports/full-audit", async (c) => {
    const location = c.get("location");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end)) throw new AppError(400, "begin and end must be YYYY-MM-DD");
    if (end <= begin) throw new AppError(400, "The ending count date must be after the beginning date");
    const productType = c.req.query("productType") || undefined;
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await buildFullAudit(location.id, begin, end, productType, allowed, basisOf(c)));
  })

  .get("/reports/full-audit/drill", async (c) => {
    const location = c.get("location");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    const locationItemId = c.req.query("locationItemId") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || !locationItemId) throw new AppError(400, "begin, end, locationItemId required");
    return c.json({ records: await fullAuditDrill(location.id, locationItemId, begin, end) });
  })

  .get("/reports/full-audit/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const productType = c.req.query("productType") || undefined;
    const allowed = allowedProductTypes(c.get("locationModules"));
    let report = await buildFullAudit(location.id, begin, end, productType, allowed, basisOf(c));
    // ?variance=only → the Variance Report (client req #10): only rows that
    // carry a variance, with subset totals computed from the surviving rows.
    const varianceOnly = c.req.query("variance") === "only";
    if (varianceOnly) {
      const rows = report.rows.filter((r) => r.variance !== 0);
      const categories = report.categories
        .map((g) => ({ ...g, rows: g.rows.filter((r) => r.variance !== 0) }))
        .filter((g) => g.rows.length > 0);
      const totals = rows.reduce(
        (t, r) => ({
          beginCost: t.beginCost + r.beginCost,
          endCost: t.endCost + r.endCost,
          usageCost: t.usageCost + r.usageCost,
          revenue: t.revenue + r.revenue,
          nonRevenueCost: t.nonRevenueCost + r.nonRevenueCost,
          varianceCost: t.varianceCost + r.varianceCost,
          varianceRetail: t.varianceRetail + r.varianceRetail,
        }),
        { beginCost: 0, endCost: 0, usageCost: 0, revenue: 0, nonRevenueCost: 0, varianceCost: 0, varianceRetail: 0 },
      );
      report = { ...report, rows, categories, totals };
    }
    const user = c.get("user")!;
    const base = varianceOnly ? "variance-report" : "full-audit";
    const name = `${base}_${location.name}_${begin}_${end}${basisSuffix(basisOf(c))}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(fullAuditCsv(report), name, fullName(user));
    if (format === "pdf") return pdfResponse(await fullAuditPdfDoc(report, await meta(client, location.name, user), varianceOnly), name);
    return xlsxResponse(await fullAuditWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Legacy-layout audit exports (client reports #1 Detailed / #2 Inventory) ──
  .get("/reports/legacy-audit/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const variant: LegacyAuditVariant = c.req.query("variant") === "inventory" ? "inventory" : "detailed";
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await legacyAuditReport(location.id, begin, end, allowed, variant, basisOf(c));
    const user = c.get("user")!;
    const name = `${legacyAuditTitle(variant)}_${location.name}_${begin}_${end}${basisSuffix(basisOf(c))}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(legacyAuditCsv(report, variant), name, fullName(user));
    if (format === "pdf") return pdfResponse(await legacyAuditPdf(report, await meta(client, location.name, user), variant), name);
    return xlsxResponse(await legacyAuditWorkbook(report, await meta(client, location.name, user), variant), name);
  })

  // ── Cost snapshots (client reports #3 Beginning / #4 Ending) ──
  .get("/reports/cost-snapshot", async (c) => {
    const location = c.get("location");
    const anchor = c.req.query("anchor") ?? "";
    if (!DATE_RE.test(anchor)) throw new AppError(400, "anchor must be YYYY-MM-DD");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await costSnapshotReport(location.id, anchor, allowed, basisOf(c)));
  })
  .get("/reports/cost-snapshot/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const anchor = c.req.query("anchor") ?? "";
    if (!DATE_RE.test(anchor)) throw new AppError(400, "anchor must be YYYY-MM-DD");
    const side = c.req.query("side") === "ending" ? "Ending" : "Beginning";
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await costSnapshotReport(location.id, anchor, allowed, basisOf(c));
    const user = c.get("user")!;
    const name = `${side.toLowerCase()}-cost_${location.name}_${anchor}${basisSuffix(basisOf(c))}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(costSnapshotCsv(report, side), name, fullName(user));
    if (format === "pdf") return pdfResponse(await costSnapshotPdf(report, await meta(client, location.name, user), side), name);
    return xlsxResponse(await costSnapshotWorkbook(report, await meta(client, location.name, user), side), name);
  })

  // ── Forfeited Bottles (client report #5) ──
  .get("/reports/forfeits", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await forfeitsReport(location.id, from, to, allowed));
  })
  .get("/reports/forfeits/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await forfeitsReport(location.id, from, to, allowed);
    const user = c.get("user")!;
    const name = `forfeited-bottles_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(forfeitsCsv(report), name, fullName(user));
    if (format === "pdf") return pdfResponse(await forfeitsPdf(report, await meta(client, location.name, user)), name);
    return xlsxResponse(await forfeitsWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Usage Cost (client report #6) ──
  .get("/reports/usage-cost", async (c) => {
    const location = c.get("location");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await usageCostReport(location.id, begin, end, allowed));
  })
  .get("/reports/usage-cost/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await usageCostReport(location.id, begin, end, allowed);
    const user = c.get("user")!;
    const name = `usage-cost_${location.name}_${begin}_${end}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(usageCostCsv(report), name, fullName(user));
    if (format === "pdf") return pdfResponse(await usageCostPdf(report, await meta(client, location.name, user)), name);
    return xlsxResponse(await usageCostWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Sales by Item — shot & bottle (client report #7) ──
  .get("/reports/sales-by-item", async (c) => {
    const location = c.get("location");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await salesByItemReport(location.id, begin, end, allowed));
  })
  .get("/reports/sales-by-item/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await salesByItemReport(location.id, begin, end, allowed);
    const user = c.get("user")!;
    const name = `sales-by-item_${location.name}_${begin}_${end}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(salesByItemCsv(report), name, fullName(user));
    if (format === "pdf") return pdfResponse(await salesByItemPdf(report, await meta(client, location.name, user)), name);
    return xlsxResponse(await salesByItemWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Cost Analysis (combined bar+kitchen, beverage/food cost %) ──
  .get("/reports/cost-analysis", async (c) => {
    const location = c.get("location");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end)) throw new AppError(400, "begin and end must be YYYY-MM-DD");
    if (end <= begin) throw new AppError(400, "The ending count date must be after the beginning date");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await costAnalysisReport(location.id, begin, end, allowed, basisOf(c)));
  })
  .get("/reports/cost-analysis/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await costAnalysisReport(location.id, begin, end, allowed, basisOf(c));
    const user = c.get("user")!;
    const name = `cost-analysis_${location.name}_${begin}_${end}${basisSuffix(basisOf(c))}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(costAnalysisCsv(report), name, fullName(user));
    return xlsxResponse(await costAnalysisWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Sales (views: sales | discounted | production — client req 2026-07-20) ──
  .get("/reports/sales", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await salesReport(location.id, from, to, allowed, salesView(c.req.query("view"))));
  })
  .get("/reports/sales/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    const view = salesView(c.req.query("view"));
    const report = await salesReport(location.id, from, to, allowed, view);
    const user = c.get("user")!;
    const title =
      view === "discounted" ? "Discounted Sales Report" : view === "production" ? "Production Report" : "Sales Report";
    const name = `${view}_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(salesCsv(report, title), name, fullName(user));
    if (format === "pdf") return pdfResponse(await salesPdfDoc(report, await meta(client, location.name, user), title), name);
    return xlsxResponse(await salesWorkbook(report, await meta(client, location.name, user), title), name);
  })

  // ── Purchases ──
  .get("/reports/purchases", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await purchaseReport(location.id, from, to, allowed));
  })
  .get("/reports/purchases/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await purchaseReport(location.id, from, to, allowed);
    const user = c.get("user")!;
    const name = `purchases_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(purchaseCsv(report), name, fullName(user));
    if (format === "pdf") return pdfResponse(await purchasePdfDoc(report, await meta(client, location.name, user)), name);
    return xlsxResponse(await purchaseWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Non-revenue (optional ?group= bucket — client req 2026-07-20) ──
  .get("/reports/non-revenue", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await nonRevenueReport(location.id, from, to, allowed, nrGroup(c.req.query("group"))));
  })
  .get("/reports/non-revenue/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    const group = nrGroup(c.req.query("group"));
    const report = await nonRevenueReport(location.id, from, to, allowed, group);
    const user = c.get("user")!;
    const title = group ? `Non-Revenue Report — ${NON_REVENUE_GROUP_LABELS[group]}` : "Non-Revenue Report";
    const name = `${group ? group.toLowerCase() : "non-revenue"}_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(nonRevenueCsv(report, title), name, fullName(user));
    if (format === "pdf") return pdfResponse(await nonRevenuePdfDoc(report, await meta(client, location.name, user), title), name);
    return xlsxResponse(await nonRevenueWorkbook(report, await meta(client, location.name, user), title), name);
  })

  // ── Transfers (in/out at cost & retail) ──
  .get("/reports/transfers", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    const direction = c.req.query("direction") === "in" ? "in" : "out";
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await transferReport(location.id, from, to, direction, allowed));
  })
  .get("/reports/transfers/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const direction = c.req.query("direction") === "in" ? "in" : "out";
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await transferReport(location.id, from, to, direction, allowed);
    const user = c.get("user")!;
    const name = `transfers-${direction}_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(transferCsv(report), name, fullName(user));
    if (format === "pdf") return pdfResponse(await transferPdfDoc(report, await meta(client, location.name, user), direction), name);
    return xlsxResponse(await transferWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Inventory on hand ──
  .get("/reports/on-hand", async (c) => {
    const location = c.get("location");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await onHandReport(location.id, allowed, basisOf(c)));
  })
  .get("/reports/on-hand/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await onHandReport(location.id, allowed, basisOf(c));
    const user = c.get("user")!;
    const name = `on-hand_${location.name}_${report.lastCountDate ?? "current"}${basisSuffix(basisOf(c))}`.replace(/[^\w.-]+/g, "-");
    const format = c.req.query("format");
    if (format === "csv") return csvResponse(onHandCsv(report), name, fullName(user));
    if (format === "pdf") return pdfResponse(await onHandPdfDoc(report, await meta(client, location.name, user)), name);
    return xlsxResponse(await onHandWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Top Sellers (replaces legacy Graph report) ──
  .get("/reports/top-sellers", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    const limitParam = parseInt(c.req.query("limit") ?? "10", 10);
    const limit = [10, 25, 50].includes(limitParam) ? limitParam : 10;
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await topSellersReport(location.id, from, to, allowed, limit));
  })
  .get("/reports/top-sellers/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await topSellersReport(location.id, from, to, allowed);
    const user = c.get("user")!;
    const name = `top-sellers_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(topSellersCsv(report), name, fullName(user));
    return xlsxResponse(await topSellersWorkbook(report, await meta(client, location.name, user)), name);
  })

  // Back-compat: the stock page reads on-hand quantities here.
  .get("/stock/on-hand", async (c) => {
    const location = c.get("location");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await onHandReport(location.id, allowed, basisOf(c));
    return c.json(report.rows.map((r) => ({ locationItemId: r.locationItemId, onHand: r.onHand, lastCountDate: report.lastCountDate })));
  });

async function meta(
  client: { id: string; name: string },
  locationName: string,
  user?: { firstName: string; lastName: string },
): Promise<ReportMeta> {
  const company = await getCompanyInfo(client.id);
  return {
    clientName: client.name,
    locationName,
    legalName: company.legalName || undefined,
    address: company.address || undefined,
    footer: company.reportFooter || undefined,
    exportedBy: user ? fullName(user) : undefined,
  };
}
