import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validate";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";

/**
 * Storage areas within one location — the columns on the client's paper count
 * sheet (MAIN BAR / COCKTAIL LOUNGE / BEER HALL / STOCK ROOM).
 *
 * Mounted inside the location-scoped group, so `requireAuth` and
 * `requireLocationAccess` have already run and `c.get("location")` is this
 * user's own establishment. Nothing here re-checks tenancy for that reason.
 */

const areaBody = z.object({
  name: z.string().trim().min(1, "Give the area a name").max(60),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const manageGuard = requirePermission("master.write");

export const areaRoutes = new Hono<AppEnv>()
  .get("/areas", async (c) => {
    const location = c.get("location");
    const areas = await prisma.locationArea.findMany({
      where: { locationId: location.id, status: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return c.json(areas);
  })

  .post("/areas", manageGuard, zValidator("json", areaBody), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    // Appended by default, so adding one never silently reorders a sheet
    // somebody is already counting against.
    const last = await prisma.locationArea.aggregate({
      where: { locationId: location.id },
      _max: { sortOrder: true },
    });
    const area = await prisma.$transaction(async (tx) => {
      const created = await tx.locationArea.create({
        data: {
          locationId: location.id,
          name: body.name,
          sortOrder: body.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
        },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "area.create",
          entity: "LocationArea",
          entityId: created.id,
          summary: `Added storage area "${created.name}"`,
        },
        tx,
      );
      return created;
    });
    return c.json(area, 201);
  })

  .put("/areas/:id", manageGuard, zValidator("json", areaBody), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const existing = await prisma.locationArea.findUnique({ where: { id: c.req.param("id") } });
    if (!existing || existing.locationId !== location.id) throw new AppError(404, "Area not found");
    const body = c.req.valid("json");
    const area = await prisma.$transaction(async (tx) => {
      const updated = await tx.locationArea.update({
        where: { id: existing.id },
        data: { name: body.name, sortOrder: body.sortOrder ?? existing.sortOrder },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "area.update",
          entity: "LocationArea",
          entityId: updated.id,
          summary:
            existing.name === updated.name
              ? `Reordered storage area "${updated.name}"`
              : `Renamed storage area "${existing.name}" to "${updated.name}"`,
        },
        tx,
      );
      return updated;
    });
    return c.json(area);
  })

  /**
   * Archive, never delete.
   *
   * Count lines point at areas, and those lines are part of committed periods.
   * Deleting the row would either orphan them or rewrite history depending on
   * the FK — and "where was this counted?" must still answer correctly for a
   * period closed two months ago. Archiving takes it out of the pickers and
   * leaves every past sheet intact.
   */
  .delete("/areas/:id", manageGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const existing = await prisma.locationArea.findUnique({ where: { id: c.req.param("id") } });
    if (!existing || existing.locationId !== location.id) throw new AppError(404, "Area not found");
    await prisma.$transaction(async (tx) => {
      await tx.locationArea.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "area.archive",
          entity: "LocationArea",
          entityId: existing.id,
          summary: `Archived storage area "${existing.name}"`,
        },
        tx,
      );
    });
    return c.json({ ok: true });
  });
