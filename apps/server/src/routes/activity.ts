import { Hono } from "hono";
import { prisma } from "../db";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Activity trail viewer. ADMIN sees everything; MANAGER is scoped to the
 * clients they're assigned to. Filters: client, user, entity, action prefix,
 * free-text summary, and an inclusive [from, to] day range on the timestamp.
 */
export const activityRoutes = new Hono<AppEnv>()
  .use(requireAuth, requirePermission("activity.view"))

  .get("/", async (c) => {
    const user = c.get("user")!;
    const q = c.req.query();

    // Non-admins only ever see activity for their assigned clients.
    let clientScope: string[] | null = null;
    if (user.role !== "ADMIN") {
      const access = await prisma.userClientAccess.findMany({
        where: { userId: user.id },
        select: { clientId: true },
      });
      clientScope = access.map((a) => a.clientId);
      if (clientScope.length === 0) return c.json({ rows: [] });
    }

    const clientFilter = q.clientId
      ? clientScope && !clientScope.includes(q.clientId)
        ? ["__none__"] // requested a client they can't see
        : [q.clientId]
      : clientScope;

    const ts: { gte?: Date; lte?: Date } = {};
    if (DATE_RE.test(q.from ?? "")) ts.gte = new Date(`${q.from}T00:00:00`);
    if (DATE_RE.test(q.to ?? "")) ts.lte = new Date(`${q.to}T23:59:59.999`);

    const rows = await prisma.activityLog.findMany({
      where: {
        clientId: clientFilter ? { in: clientFilter } : undefined,
        userId: q.userId || undefined,
        entity: q.entity || undefined,
        action: q.action ? { startsWith: q.action } : undefined,
        summary: q.search ? { contains: q.search } : undefined,
        ts: ts.gte || ts.lte ? ts : undefined,
      },
      orderBy: { ts: "desc" },
      take: Math.min(Number(q.limit) || 200, 500),
      select: {
        id: true, ts: true, userName: true, action: true,
        entity: true, entityId: true, summary: true, detailsJson: true,
        clientId: true, locationId: true,
      },
    });

    return c.json({
      rows: rows.map((r) => ({
        id: r.id,
        ts: r.ts.toISOString(),
        userName: r.userName,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        summary: r.summary,
        details: r.detailsJson,
      })),
    });
  });
