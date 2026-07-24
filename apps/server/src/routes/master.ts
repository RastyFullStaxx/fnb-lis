import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  categoryUpsert,
  conditionOptionsUpdate,
  industryOptionsUpdate,
  itemCreate,
  itemUpdate,
  productTypesUpdate,
  statusOptionsUpdate,
  unitCreate,
  variantCreate,
  variantUpdate,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

const writeGuard = requirePermission("master.write");

/**
 * NET weigh mode (client req #16) is only coherent when (a) the variant is
 * NOT content-tracked — otherwise reconciliation would divide the net weight
 * by the container size — and (b) the counting unit is itself a weight, so
 * the g/oz net reading converts straight into it. Checked on every create
 * AND on updates against the merged result.
 */
async function assertWeighModeValid(
  weighMode: string | null,
  contentTracked: boolean,
  unitId: string,
): Promise<void> {
  if (weighMode !== "NET") return;
  if (contentTracked) {
    throw new AppError(400, "Net weight mode and open-content tracking are mutually exclusive — pick one");
  }
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit || unit.kind !== "MASS") {
    throw new AppError(400, `Net weight mode needs a weight-based counting unit — this variant counts in ${unit?.name ?? "an unknown unit"}`);
  }
}

export const masterRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // ── Units ──
  .get("/units", async (c) => {
    const units = await prisma.unit.findMany({ orderBy: [{ kind: "asc" }, { factorToBase: "asc" }] });
    return c.json(units);
  })
  .post("/units", writeGuard, zValidator("json", unitCreate), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const exists = await prisma.unit.findUnique({ where: { name: body.name } });
    if (exists) throw new AppError(409, `Unit "${body.name}" already exists`);
    const unit = await prisma.$transaction(async (tx) => {
      const created = await tx.unit.create({ data: body });
      await logActivity(
        { user, action: "unit.create", entity: "Unit", entityId: created.id, summary: `Added unit ${created.name} (${created.kind}, ×${created.factorToBase})` },
        tx,
      );
      return created;
    });
    return c.json(unit, 201);
  })
  .put("/units/:id", writeGuard, zValidator("json", unitCreate.partial()), async (c) => {
    const unitId = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const existing = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!existing) throw new AppError(404, "Unit not found");
    if (existing.isSystem) throw new AppError(403, "System units cannot be edited");
    const unit = await prisma.$transaction(async (tx) => {
      const updated = await tx.unit.update({ where: { id: unitId }, data: body });
      await logActivity(
        { user, action: "unit.update", entity: "Unit", entityId: unitId, summary: `Updated unit ${updated.name}`, details: body },
        tx,
      );
      return updated;
    });
    return c.json(unit);
  })

  // ── Product types (data-driven list in Setting) ──
  .get("/product-types", async (c) => {
    const setting = await prisma.setting.findUnique({ where: { clientId_key: { clientId: "", key: "productTypes" } } });
    return c.json({ productTypes: setting ? (JSON.parse(setting.value) as string[]) : [] });
  })
  .put("/product-types", requirePermission("admin.manage"), zValidator("json", productTypesUpdate), async (c) => {
    const { productTypes } = c.req.valid("json");
    const user = c.get("user")!;
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { clientId_key: { clientId: "", key: "productTypes" } },
        update: { value: JSON.stringify(productTypes) },
        create: { clientId: "", key: "productTypes", value: JSON.stringify(productTypes) },
      });
      await logActivity(
        { user, action: "settings.productTypes", entity: "Setting", summary: `Product types set to ${productTypes.join(", ")}`, details: { productTypes } },
        tx,
      );
    });
    return c.json({ productTypes });
  })

  // ── Asset Condition / Status / Industry options (data-driven lists in
  //    Setting, architecture.md deviation #21) — mirrors /product-types
  //    exactly. Industry added client req 2026-07-24. ──
  .get("/condition-options", async (c) => {
    const setting = await prisma.setting.findUnique({ where: { clientId_key: { clientId: "", key: "conditionOptions" } } });
    return c.json({ conditionOptions: setting ? (JSON.parse(setting.value) as string[]) : [] });
  })
  .put("/condition-options", requirePermission("admin.manage"), zValidator("json", conditionOptionsUpdate), async (c) => {
    const { conditionOptions } = c.req.valid("json");
    const user = c.get("user")!;
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { clientId_key: { clientId: "", key: "conditionOptions" } },
        update: { value: JSON.stringify(conditionOptions) },
        create: { clientId: "", key: "conditionOptions", value: JSON.stringify(conditionOptions) },
      });
      await logActivity(
        { user, action: "settings.conditionOptions", entity: "Setting", summary: `Condition options set to ${conditionOptions.join(", ")}`, details: { conditionOptions } },
        tx,
      );
    });
    return c.json({ conditionOptions });
  })
  .get("/status-options", async (c) => {
    const setting = await prisma.setting.findUnique({ where: { clientId_key: { clientId: "", key: "statusOptions" } } });
    return c.json({ statusOptions: setting ? (JSON.parse(setting.value) as string[]) : [] });
  })
  .put("/status-options", requirePermission("admin.manage"), zValidator("json", statusOptionsUpdate), async (c) => {
    const { statusOptions } = c.req.valid("json");
    const user = c.get("user")!;
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { clientId_key: { clientId: "", key: "statusOptions" } },
        update: { value: JSON.stringify(statusOptions) },
        create: { clientId: "", key: "statusOptions", value: JSON.stringify(statusOptions) },
      });
      await logActivity(
        { user, action: "settings.statusOptions", entity: "Setting", summary: `Status options set to ${statusOptions.join(", ")}`, details: { statusOptions } },
        tx,
      );
    });
    return c.json({ statusOptions });
  })
  .get("/industry-options", async (c) => {
    const setting = await prisma.setting.findUnique({ where: { clientId_key: { clientId: "", key: "industryOptions" } } });
    return c.json({ industryOptions: setting ? (JSON.parse(setting.value) as string[]) : [] });
  })
  .put("/industry-options", requirePermission("admin.manage"), zValidator("json", industryOptionsUpdate), async (c) => {
    const { industryOptions } = c.req.valid("json");
    const user = c.get("user")!;
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { clientId_key: { clientId: "", key: "industryOptions" } },
        update: { value: JSON.stringify(industryOptions) },
        create: { clientId: "", key: "industryOptions", value: JSON.stringify(industryOptions) },
      });
      await logActivity(
        { user, action: "settings.industryOptions", entity: "Setting", summary: `Industry options set to ${industryOptions.join(", ")}`, details: { industryOptions } },
        tx,
      );
    });
    return c.json({ industryOptions });
  })

  // ── Categories ──
  .get("/categories", async (c) => {
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: true } } },
    });
    return c.json(categories);
  })
  .post("/categories", writeGuard, zValidator("json", categoryUpsert), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const exists = await prisma.category.findUnique({ where: { name: body.name } });
    if (exists) throw new AppError(409, `Category "${body.name}" already exists`);
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: { ...body, defaultDensityFactor: body.defaultDensityFactor ?? null, sortOrder: body.sortOrder ?? 0 },
      });
      await logActivity(
        { user, action: "category.create", entity: "Category", entityId: created.id, summary: `Added category ${created.name} (${created.productType})` },
        tx,
      );
      return created;
    });
    return c.json(category, 201);
  })
  .put("/categories/:id", writeGuard, zValidator("json", categoryUpsert.partial()), async (c) => {
    const categoryId = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id: categoryId },
        data: { ...body, defaultDensityFactor: body.defaultDensityFactor === undefined ? undefined : body.defaultDensityFactor },
      });
      await logActivity(
        { user, action: "category.update", entity: "Category", entityId: categoryId, summary: `Updated category ${updated.name}`, details: body },
        tx,
      );
      return updated;
    });
    return c.json(category);
  })

  // ── Items & variants ──
  .get("/items", async (c) => {
    const search = c.req.query("search")?.trim();
    const categoryId = c.req.query("categoryId");
    const productType = c.req.query("productType");
    const items = await prisma.item.findMany({
      where: {
        isActive: c.req.query("includeInactive") === "1" ? undefined : true,
        name: search ? { contains: search } : undefined,
        categoryId: categoryId || undefined,
        category: productType ? { productType } : undefined,
      },
      include: {
        category: true,
        variants: { include: { unit: true }, orderBy: { size: "asc" } },
      },
      orderBy: { name: "asc" },
      take: 500,
    });
    return c.json(items);
  })
  .get("/items/check-name", async (c) => {
    const name = c.req.query("name")?.trim() ?? "";
    if (!name) return c.json({ taken: false });
    const existing = await prisma.item.findFirst({ where: { name: { equals: name } } });
    return c.json({ taken: Boolean(existing) });
  })
  .post("/items", writeGuard, zValidator("json", itemCreate), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const duplicate = await prisma.item.findFirst({ where: { name: { equals: body.name } } });
    if (duplicate) throw new AppError(409, `An item named "${body.name}" already exists`);
    for (const v of body.variants) {
      await assertWeighModeValid(v.weighMode ?? null, v.contentTracked, v.unitId);
    }
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: {
          name: body.name,
          categoryId: body.categoryId,
          description: body.description ?? null,
          createdById: user.id,
          variants: {
            create: body.variants.map((v) => ({
              size: v.size,
              unitId: v.unitId,
              contentTracked: v.contentTracked,
              weighMode: v.weighMode ?? null,
              tareWeight: v.tareWeight ?? null,
              tareWeightUnit: v.tareWeightUnit ?? null,
              densityFactor: v.densityFactor ?? null,
              barcode: v.barcode ?? null,
            })),
          },
        },
        include: { category: true, variants: { include: { unit: true } } },
      });
      await logActivity(
        { user, action: "item.create", entity: "Item", entityId: created.id, summary: `Added item ${created.name} with ${created.variants.length} variant(s)` },
        tx,
      );
      return created;
    });
    return c.json(item, 201);
  })
  .put("/items/:id", writeGuard, zValidator("json", itemUpdate), async (c) => {
    const itemId = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id: itemId },
        data: body,
        include: { category: true, variants: { include: { unit: true } } },
      });
      await logActivity(
        { user, action: "item.update", entity: "Item", entityId: itemId, summary: `Updated item ${updated.name}`, details: body },
        tx,
      );
      return updated;
    });
    return c.json(item);
  })
  .post("/items/:id/variants", writeGuard, zValidator("json", variantCreate), async (c) => {
    const itemId = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const exists = await prisma.itemVariant.findUnique({
      where: { itemId_size_unitId: { itemId, size: body.size, unitId: body.unitId } },
    });
    if (exists) throw new AppError(409, "This size/unit variant already exists for the item");
    await assertWeighModeValid(body.weighMode ?? null, body.contentTracked, body.unitId);
    const variant = await prisma.$transaction(async (tx) => {
      const created = await tx.itemVariant.create({
        data: {
          itemId,
          size: body.size,
          unitId: body.unitId,
          contentTracked: body.contentTracked,
          weighMode: body.weighMode ?? null,
          tareWeight: body.tareWeight ?? null,
          tareWeightUnit: body.tareWeightUnit ?? null,
          densityFactor: body.densityFactor ?? null,
          barcode: body.barcode ?? null,
        },
        include: { unit: true, item: true },
      });
      await logActivity(
        { user, action: "variant.create", entity: "ItemVariant", entityId: created.id, summary: `Added variant ${created.item.name} ${created.size} ${created.unit.name}` },
        tx,
      );
      return created;
    });
    return c.json(variant, 201);
  })
  .put("/variants/:id", writeGuard, zValidator("json", variantUpdate), async (c) => {
    const variantId = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;
    // Validate against the MERGED result — a PUT that changes only unitId or
    // only contentTracked must not slip an existing NET variant into an
    // invalid combination.
    const current = await prisma.itemVariant.findUnique({ where: { id: variantId } });
    if (!current) throw new AppError(404, "Variant not found");
    await assertWeighModeValid(
      body.weighMode !== undefined ? body.weighMode : current.weighMode,
      body.contentTracked ?? current.contentTracked,
      body.unitId ?? current.unitId,
    );
    const variant = await prisma.$transaction(async (tx) => {
      const updated = await tx.itemVariant.update({
        where: { id: variantId },
        data: body,
        include: { unit: true, item: true },
      });
      await logActivity(
        { user, action: "variant.update", entity: "ItemVariant", entityId: variantId, summary: `Updated variant ${updated.item.name} ${updated.size} ${updated.unit.name}`, details: body },
        tx,
      );
      return updated;
    });
    return c.json(variant);
  });
