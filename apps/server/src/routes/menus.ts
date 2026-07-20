import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { menuCreate, recipeCost, recipePublish } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";

const writeGuard = requirePermission("menus.write");

/**
 * Legacy "Copy Local DB" copied client_bottles AND client_menus/
 * client_menus_ingridients together in one transaction. The new system split
 * catalog-copy out onto Stock (useCopyFromLocation) — this is the missing
 * recipe half. A RecipeLine points at a location-scoped LocationItem, not
 * the global ItemVariant, so a straight copy can't just clone rows: every
 * ingredient line has to be REMAPPED to the destination's LocationItem for
 * the same ItemVariant. If the destination doesn't stock an ingredient yet,
 * that menu is skipped whole (a recipe silently missing an ingredient is
 * worse than not copying it) — copy the catalog first, then recipes.
 */
async function copyMenusBetweenLocations(opts: {
  destinationLocationId: string;
  sourceLocationId: string;
  publishedById: string;
}) {
  const { destinationLocationId, sourceLocationId, publishedById } = opts;

  const [sourceMenus, destLocationItems, destExistingNames] = await Promise.all([
    prisma.menuItem.findMany({
      where: { locationId: sourceLocationId, isActive: true },
      include: {
        versions: {
          orderBy: { versionNo: "desc" },
          take: 1,
          include: {
            lines: { orderBy: { sortOrder: "asc" }, include: { locationItem: { include: { itemVariant: true } } } },
          },
        },
      },
    }),
    prisma.locationItem.findMany({
      where: { locationId: destinationLocationId },
      include: { itemVariant: true },
    }),
    prisma.menuItem.findMany({ where: { locationId: destinationLocationId }, select: { name: true } }),
  ]);

  const destByVariantId = new Map(destLocationItems.map((li) => [li.itemVariantId, li]));
  const destNameSet = new Set(destExistingNames.map((m) => m.name.toLowerCase()));

  const toCopy: typeof sourceMenus = [];
  const skippedExisting: string[] = [];
  const skippedNoRecipe: string[] = [];
  const skippedMissingIngredients: { name: string; missing: string[] }[] = [];

  for (const menu of sourceMenus) {
    if (destNameSet.has(menu.name.toLowerCase())) {
      skippedExisting.push(menu.name);
      continue;
    }
    const version = menu.versions[0];
    if (!version || version.lines.length === 0) {
      skippedNoRecipe.push(menu.name);
      continue;
    }
    const missingLines = version.lines.filter((line) => !destByVariantId.has(line.locationItem.itemVariantId));
    if (missingLines.length > 0) {
      skippedMissingIngredients.push({
        name: menu.name,
        missing: missingLines.map((line) => line.locationItem.itemVariant.id),
      });
      continue;
    }
    toCopy.push(menu);
  }

  const copied: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const menu of toCopy) {
      const version = menu.versions[0];
      const lines = version.lines.map((line) => {
        const destIngredient = destByVariantId.get(line.locationItem.itemVariantId)!;
        return {
          destLocationItemId: destIngredient.id,
          servingQty: line.servingQty,
          sortOrder: line.sortOrder,
          size: destIngredient.itemVariant.size,
          contentTracked: destIngredient.itemVariant.contentTracked,
          ingredientCost: destIngredient.cost,
        };
      });
      // Recompute cost at destination — ingredient costs may differ by location.
      const costAtPublish = recipeCost(lines);

      const createdMenu = await tx.menuItem.create({
        data: {
          locationId: destinationLocationId,
          name: menu.name,
          versions: {
            create: {
              versionNo: 1,
              srp: version.srp,
              costAtPublish,
              publishedById,
              note: `Copied from another location's recipe (source v${version.versionNo})`,
              lines: {
                create: lines.map((l, i) => ({
                  locationItemId: l.destLocationItemId,
                  servingQty: l.servingQty,
                  sortOrder: l.sortOrder ?? i,
                })),
              },
            },
          },
        },
      });
      copied.push(createdMenu.name);
    }
  });

  return {
    copied: copied.length,
    skippedExisting: skippedExisting.length,
    skippedNoRecipe: skippedNoRecipe.length,
    skippedMissingIngredients: skippedMissingIngredients.length,
    missingIngredientMenus: skippedMissingIngredients.map((m) => m.name),
  };
}

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
  /**
   * Legacy "copy local database" (recipe half): pull another location's
   * recipes, remapped onto this location's own catalog rows. Menus that
   * already exist here (by name), or whose recipe uses an ingredient this
   * location doesn't stock, are skipped — copy the catalog first via Stock's
   * "Copy catalog" to maximize how many recipes come across clean.
   */
  .post("/menus/copy-from/:otherLocationId", writeGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const otherId = c.req.param("otherLocationId");
    if (otherId === location.id) throw new AppError(400, "Choose a different location to copy from");

    const other = await prisma.location.findUnique({ where: { id: otherId }, include: { client: true } });
    if (!other) throw new AppError(404, "Source location not found");
    if (user.role !== "ADMIN") {
      const access = await prisma.userClientAccess.findUnique({
        where: { userId_clientId: { userId: user.id, clientId: other.clientId } },
      });
      if (!access) throw new AppError(403, "No access to the source location");
    }

    const result = await copyMenusBetweenLocations({
      destinationLocationId: location.id,
      sourceLocationId: otherId,
      publishedById: user.id,
    });

    await prisma.$transaction(async (tx) => {
      const notes: string[] = [];
      if (result.skippedExisting) notes.push(`${result.skippedExisting} already existed`);
      if (result.skippedNoRecipe) notes.push(`${result.skippedNoRecipe} had no published recipe`);
      if (result.skippedMissingIngredients) {
        notes.push(`${result.skippedMissingIngredients} skipped — missing ingredient(s) in this location's catalog`);
      }
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "menu.copyFrom", entity: "Location", entityId: location.id,
          summary: `Copied ${result.copied} recipe(s) from ${other.client.name} / ${other.name}`
            + (notes.length ? ` (${notes.join("; ")})` : ""),
          details: result,
        },
        tx,
      );
    });

    return c.json(result);
  })

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
