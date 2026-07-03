import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { menuCreate, recipeCost, recipePublish } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";

const writeGuard = requirePermission("menus.write");

const VERSION_INCLUDE = {
  lines: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      locationItem: {
        include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      },
    },
  },
} as const;

export const menuRoutes = new Hono<AppEnv>()
  .get("/menus", async (c) => {
    const location = c.get("location");
    const menus = await prisma.menuItem.findMany({
      where: { locationId: location.id },
      include: {
        versions: { orderBy: { versionNo: "desc" }, take: 1, include: { lines: true } },
        _count: { select: { versions: true, sales: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { name: "asc" },
    });
    return c.json(
      menus.map((m) => ({
        id: m.id,
        name: m.name,
        isActive: m.isActive,
        versionCount: m._count.versions,
        salesCount: m._count.sales,
        current: m.versions[0]
          ? {
              id: m.versions[0].id,
              versionNo: m.versions[0].versionNo,
              srp: m.versions[0].srp,
              costAtPublish: m.versions[0].costAtPublish,
              lineCount: m.versions[0].lines.length,
            }
          : null,
      })),
    );
  })

  .post("/menus", writeGuard, zValidator("json", menuCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { name } = c.req.valid("json");
    const duplicate = await prisma.menuItem.findFirst({ where: { locationId: location.id, name } });
    if (duplicate) throw new AppError(409, `A menu named "${name}" already exists here`);
    const menu = await prisma.$transaction(async (tx) => {
      const created = await tx.menuItem.create({ data: { locationId: location.id, name } });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "menu.create", entity: "MenuItem", entityId: created.id, summary: `Created menu "${name}"` },
        tx,
      );
      return created;
    });
    return c.json(menu, 201);
  })

  .get("/menus/:id", async (c) => {
    const location = c.get("location");
    const menu = await prisma.menuItem.findUnique({
      where: { id: c.req.param("id") },
      include: { versions: { orderBy: { versionNo: "desc" }, include: VERSION_INCLUDE } },
    });
    if (!menu || menu.locationId !== location.id) throw new AppError(404, "Menu not found");
    return c.json(menu);
  })

  /** Publishing creates a NEW immutable version — history never drifts. */
  .post("/menus/:id/versions", writeGuard, zValidator("json", recipePublish), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const menu = await prisma.menuItem.findUnique({
      where: { id: c.req.param("id") },
      include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } },
    });
    if (!menu || menu.locationId !== location.id) throw new AppError(404, "Menu not found");

    // Validate ingredients belong to this location and compute cost at publish.
    const ingredients = await prisma.locationItem.findMany({
      where: { id: { in: body.lines.map((l) => l.locationItemId) }, locationId: location.id },
      include: { itemVariant: true },
    });
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    for (const line of body.lines) {
      if (!byId.has(line.locationItemId)) throw new AppError(400, "An ingredient is not in this location's catalog");
    }
    const costAtPublish = recipeCost(
      body.lines.map((line) => {
        const ing = byId.get(line.locationItemId)!;
        return {
          servingQty: line.servingQty,
          size: ing.itemVariant.size,
          contentTracked: ing.itemVariant.contentTracked,
          ingredientCost: ing.cost,
        };
      }),
    );

    const versionNo = (menu.versions[0]?.versionNo ?? 0) + 1;
    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.recipeVersion.create({
        data: {
          menuItemId: menu.id,
          versionNo,
          srp: body.srp,
          costAtPublish,
          publishedById: user.id,
          note: body.note ?? null,
          lines: {
            create: body.lines.map((line, i) => ({
              locationItemId: line.locationItemId,
              servingQty: line.servingQty,
              sortOrder: line.sortOrder ?? i,
            })),
          },
        },
        include: VERSION_INCLUDE,
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "menu.publish", entity: "RecipeVersion", entityId: created.id, summary: `Published "${menu.name}" v${versionNo} (SRP ${body.srp}, cost ${costAtPublish.toFixed(2)})` },
        tx,
      );
      return created;
    });
    return c.json(version, 201);
  })

  .put(
    "/menus/:id",
    writeGuard,
    zValidator("json", z.object({ name: z.string().trim().min(1).max(120).optional(), isActive: z.boolean().optional() })),
    async (c) => {
      const location = c.get("location");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const menu = await prisma.menuItem.findUnique({ where: { id: c.req.param("id") } });
      if (!menu || menu.locationId !== location.id) throw new AppError(404, "Menu not found");
      const updated = await prisma.$transaction(async (tx) => {
        const m = await tx.menuItem.update({ where: { id: menu.id }, data: body });
        await logActivity(
          { user, clientId: location.clientId, locationId: location.id, action: "menu.update", entity: "MenuItem", entityId: menu.id, summary: `Updated menu "${m.name}"`, details: body },
          tx,
        );
        return m;
      });
      return c.json(updated);
    },
  );
