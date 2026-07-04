import { Hono } from "hono";
import { AppError } from "../lib/errors";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { buildFullAudit, committedCountDates } from "../services/report-assembly";
import {
  fullAuditDrill,
  nonRevenueReport,
  onHandReport,
  purchaseReport,
  salesReport,
} from "../services/report-lists";
import {
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
  type ReportMeta,
} from "../services/exports";
import { getCompanyInfo } from "./settings";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const exportGuard = requirePermission("reports.export");

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}

function csvResponse(text: string, filename: string): Response {
  return new Response(text, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
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
    return c.json(await buildFullAudit(location.id, begin, end, productType));
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
    const report = await buildFullAudit(location.id, begin, end, productType);
    const name = `full-audit_${location.name}_${begin}_${end}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(fullAuditCsv(report), name);
    return xlsxResponse(await fullAuditWorkbook(report, await meta(client, location.name)), name);
  })

  // ── Sales ──
  .get("/reports/sales", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    return c.json(await salesReport(location.id, from, to));
  })
  .get("/reports/sales/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const report = await salesReport(location.id, from, to);
    const name = `sales_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(salesCsv(report), name);
    return xlsxResponse(await salesWorkbook(report, await meta(client, location.name)), name);
  })

  // ── Purchases ──
  .get("/reports/purchases", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    return c.json(await purchaseReport(location.id, from, to));
  })
  .get("/reports/purchases/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const report = await purchaseReport(location.id, from, to);
    const name = `purchases_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(purchaseCsv(report), name);
    return xlsxResponse(await purchaseWorkbook(report, await meta(client, location.name)), name);
  })

  // ── Non-revenue ──
  .get("/reports/non-revenue", async (c) => {
    const location = c.get("location");
    const { from, to } = requireRange(c);
    return c.json(await nonRevenueReport(location.id, from, to));
  })
  .get("/reports/non-revenue/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from, to } = requireRange(c);
    const report = await nonRevenueReport(location.id, from, to);
    const name = `non-revenue_${location.name}_${from}_${to}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(nonRevenueCsv(report), name);
    return xlsxResponse(await nonRevenueWorkbook(report, await meta(client, location.name)), name);
  })

  // ── Inventory on hand ──
  .get("/reports/on-hand", async (c) => {
    const location = c.get("location");
    return c.json(await onHandReport(location.id));
  })
  .get("/reports/on-hand/export", exportGuard, async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const report = await onHandReport(location.id);
    const name = `on-hand_${location.name}_${report.lastCountDate ?? "current"}`.replace(/[^\w.-]+/g, "-");
    if (c.req.query("format") === "csv") return csvResponse(onHandCsv(report), name);
    return xlsxResponse(await onHandWorkbook(report, await meta(client, location.name)), name);
  })

  // Back-compat: the stock page reads on-hand quantities here.
  .get("/stock/on-hand", async (c) => {
    const location = c.get("location");
    const report = await onHandReport(location.id);
    return c.json(report.rows.map((r) => ({ locationItemId: r.locationItemId, onHand: r.onHand, lastCountDate: report.lastCountDate })));
  });

async function meta(client: { id: string; name: string }, locationName: string): Promise<ReportMeta> {
  const company = await getCompanyInfo(client.id);
  return {
    clientName: client.name,
    locationName,
    legalName: company.legalName || undefined,
    address: company.address || undefined,
    footer: company.reportFooter || undefined,
  };
}
