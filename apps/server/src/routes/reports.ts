import { Hono } from "hono";
import { allowedProductTypes, NON_REVENUE_GROUP_LABELS, NON_REVENUE_GROUPS, type NonRevenueGroup } from "@fnb/core";
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

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
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
    return c.json(await buildFullAudit(location.id, begin, end, productType, allowed));
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
    const report = await buildFullAudit(location.id, begin, end, productType, allowed);
    const user = c.get("user")!;
    const name = `full-audit_${location.name}_${begin}_${end}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(fullAuditCsv(report), name, fullName(user));
    return xlsxResponse(await fullAuditWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Cost Analysis (combined bar+kitchen, beverage/food cost %) ──
  .get("/reports/cost-analysis", async (c) => {
    const location = c.get("location");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end)) throw new AppError(400, "begin and end must be YYYY-MM-DD");
    if (end <= begin) throw new AppError(400, "The ending count date must be after the beginning date");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await costAnalysisReport(location.id, begin, end, allowed));
  })
  .get("/reports/cost-analysis/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end) || end <= begin) throw new AppError(400, "Valid begin < end required");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await costAnalysisReport(location.id, begin, end, allowed);
    const user = c.get("user")!;
    const name = `cost-analysis_${location.name}_${begin}_${end}`.replace(/[^\w.-]+/g, "-");
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
    if (c.req.query("format") === "csv") return csvResponse(salesCsv(report, title), name, fullName(user));
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
    if (c.req.query("format") === "csv") return csvResponse(purchaseCsv(report), name, fullName(user));
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
    if (c.req.query("format") === "csv") return csvResponse(nonRevenueCsv(report, title), name, fullName(user));
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
    if (c.req.query("format") === "csv") return csvResponse(transferCsv(report), name, fullName(user));
    return xlsxResponse(await transferWorkbook(report, await meta(client, location.name, user)), name);
  })

  // ── Inventory on hand ──
  .get("/reports/on-hand", async (c) => {
    const location = c.get("location");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await onHandReport(location.id, allowed));
  })
  .get("/reports/on-hand/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const report = await onHandReport(location.id, allowed);
    const user = c.get("user")!;
    const name = `on-hand_${location.name}_${report.lastCountDate ?? "current"}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(onHandCsv(report), name, fullName(user));
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
    const report = await onHandReport(location.id, allowed);
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
