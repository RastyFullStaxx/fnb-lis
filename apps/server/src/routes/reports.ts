import { Hono } from "hono";
import { AppError } from "../lib/errors";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { buildFullAudit, committedCountDates, stockOnHand } from "../services/report-assembly";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const reportRoutes = new Hono<AppEnv>()
  .use(requirePermission("reports.view"))

  .get("/reports/count-dates", async (c) => {
    const location = c.get("location");
    return c.json({ dates: await committedCountDates(location.id) });
  })

  .get("/reports/full-audit", async (c) => {
    const location = c.get("location");
    const begin = c.req.query("begin") ?? "";
    const end = c.req.query("end") ?? "";
    if (!DATE_RE.test(begin) || !DATE_RE.test(end)) throw new AppError(400, "begin and end must be YYYY-MM-DD");
    if (end <= begin) throw new AppError(400, "The ending count date must be after the beginning date");
    const productType = c.req.query("productType") || undefined;
    const report = await buildFullAudit(location.id, begin, end, productType);
    return c.json(report);
  })

  .get("/stock/on-hand", async (c) => {
    const location = c.get("location");
    return c.json(await stockOnHand(location.id));
  });
