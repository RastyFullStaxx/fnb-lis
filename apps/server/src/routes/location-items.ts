import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { allowedProductTypes, locationItemAttach, locationItemUpdate, supplierUpsert } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";

const priceGuard = requirePermission("prices.edit");

/** Mounted under /api/locations/:locationId (requireAuth + requireLocationAccess applied there). */
export const locationItemRoutes = new Hono<AppEnv>()

  // ── Location catalog ──
  .get("/location-items", async (c) => {
    const location = c.get("location");
    const search = c.req.query("search")?.trim();
    const missingPrices = c.req.query("missingPrices") === "1";
    const items = await prisma.locationItem.findMany({
      where: {
        locationId: location.id,
        isActive: c.req.query("includeInactive") === "1" ? undefined : true,
        ...(missingPrices ? { OR: [{ cost: 0 }, { retail: 0 }] } : {}),
        ...(search
          ? { itemVariant: { item: { name: { contains: search } } } }
          : {}),
      },
      include: {
        itemVariant: { include: { unit: true, item: { include: { category: true } } } },
      },
      orderBy: { itemVariant: { item: { name: "asc" } } },
      take: 1000,
    });
    return c.json(items);
  })

  .post("/location-items", priceGuard, zValidator("json", locationItemAttach), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");

    const variant = await prisma.itemVariant.findUnique({
      where: { id: body.itemVariantId },
      include: { item: { include: { category: true } } },
    });
    if (!variant) throw new AppError(404, "Item variant not found");

    // Module enforcement (Fix Plan Phase C §2.3): a location can only stock
    // product types its OWN LocationModule set covers — not just whatever
    // the client's subscription allows in total. This is the layer that
    // actually gates catalog access; Casa Verde's original bug (a Kitchen-only
    // location stocked with Beverage items) is now structurally impossible.
    const allowed = allowedProductTypes(c.get("locationModules"));
    if (allowed && !allowed.includes(variant.item.category.productType)) {
      throw new AppError(
        403,
        `This location isn't set up for ${variant.item.category.productType} inventory. Add that module to this location (or raise it on the subscription first) to add "${variant.item.name}".`,
      );
    }

    const exists = await prisma.locationItem.findUnique({
      where: { locationId_itemVariantId: { locationId: location.id, itemVariantId: body.itemVariantId } },
    });
    if (exists) {
      if (exists.isActive) throw new AppError(409, "This item is already in the location catalog");
      // Reactivate instead of duplicating.
      const revived = await prisma.locationItem.update({
        where: { id: exists.id },
        data: { isActive: true, cost: body.cost, retail: body.retail, parLevel: body.parLevel ?? null, updatedById: user.id },
        include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      });
      return c.json(revived, 200);
    }
    const created = await prisma.$transaction(async (tx) => {
      const li = await tx.locationItem.create({
        data: {
          locationId: location.id,
          itemVariantId: body.itemVariantId,
          cost: body.cost,
          retail: body.retail,
          parLevel: body.parLevel ?? null,
          updatedById: user.id,
        },
        include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "locationItem.attach", entity: "LocationItem", entityId: li.id,
          summary: `Added ${li.itemVariant.item.name} ${li.itemVariant.size} ${li.itemVariant.unit.name} to catalog (cost ${body.cost}, retail ${body.retail})`,
        },
        tx,
      );
      return li;
    });
    return c.json(created, 201);
  })

  .put("/location-items/:id", priceGuard, zValidator("json", locationItemUpdate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const itemId = c.req.param("id");
    const body = c.req.valid("json");
    const existing = await prisma.locationItem.findUnique({
      where: { id: itemId },
      include: { itemVariant: { include: { unit: true, item: true } } },
    });
    if (!existing || existing.locationId !== location.id) throw new AppError(404, "Catalog item not found");
    const updated = await prisma.$transaction(async (tx) => {
      const li = await tx.locationItem.update({
        where: { id: itemId },
        data: { ...body, updatedById: user.id },
        include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "locationItem.priceChange", entity: "LocationItem", entityId: itemId,
          summary: `Updated ${existing.itemVariant.item.name} ${existing.itemVariant.size} ${existing.itemVariant.unit.name}`,
          details: {
            old: { cost: existing.cost, retail: existing.retail, parLevel: existing.parLevel, isActive: existing.isActive },
            new: body,
          },
        },
        tx,
      );
      return li;
    });
    return c.json(updated);
  })

  /**
   * Master variants not yet in this location's catalog (for the attach dialog).
   * Restricted to this location's OWN modules (Fix Plan Phase C) — a
   * Bar-only location never sees Food/Supplies variants here, regardless of
   * the productType query param, even if its client is licensed for more.
   */
  .get("/available-variants", async (c) => {
    const location = c.get("location");
    const search = c.req.query("search")?.trim();
    const requestedProductType = c.req.query("productType");
    const allowed = allowedProductTypes(c.get("locationModules"));

    // Intersect the caller's requested type (if any) with what this location's modules allow.
    let productTypeFilter: string | { in: string[] } | undefined;
    if (requestedProductType) {
      if (allowed && !allowed.includes(requestedProductType)) {
        // Asking for a type outside this location's modules — return nothing rather
        // than 403, since this is a passive list endpoint feeding a dropdown that
        // itself will be restricted (see AdminClients/subscription UI).
        return c.json([]);
      }
      productTypeFilter = requestedProductType;
    } else if (allowed) {
      productTypeFilter = { in: [...allowed] };
    }

    const variants = await prisma.itemVariant.findMany({
      where: {
        isActive: true,
        item: {
          isActive: true,
          name: search ? { contains: search } : undefined,
          category: productTypeFilter ? { productType: productTypeFilter } : undefined,
        },
        locationItems: { none: { locationId: location.id, isActive: true } },
      },
      include: { unit: true, item: { include: { category: true } } },
      orderBy: { item: { name: "asc" } },
      take: 200,
    });
    return c.json(variants);
  })

  /**
   * Legacy "copy local database": pull another location's catalog (skips items
   * already present). Items outside the DESTINATION location's own modules
   * (Fix Plan Phase C) are silently skipped — copying across locations must
   * not be a backdoor around the module restriction, even between two
   * locations of the same client (e.g. copying Bar items into a Kitchen-only
   * location).
   */
  .post("/copy-from/:otherLocationId", priceGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const otherId = c.req.param("otherLocationId");
    if (otherId === location.id) throw new AppError(400, "Choose a different location to copy from");

    // The user must also have access to the source location's client.
    const other = await prisma.location.findUnique({ where: { id: otherId }, include: { client: true } });
    if (!other) throw new AppError(404, "Source location not found");
    if (user.role !== "ADMIN") {
      const access = await prisma.userClientAccess.findUnique({
        where: { userId_clientId: { userId: user.id, clientId: other.clientId } },
      });
      if (!access) throw new AppError(403, "No access to the source location");
    }

    const allowed = allowedProductTypes(c.get("locationModules"));
    const source = await prisma.locationItem.findMany({
      where: { locationId: otherId, isActive: true },
      include: { itemVariant: { include: { item: { include: { category: true } } } } },
    });
    const existing = await prisma.locationItem.findMany({
      where: { locationId: location.id },
      select: { itemVariantId: true },
    });
    const existingSet = new Set(existing.map((e) => e.itemVariantId));
    const eligible = source.filter((s) => !existingSet.has(s.itemVariantId));
    const blockedByModule = allowed
      ? eligible.filter((s) => !allowed.includes(s.itemVariant.item.category.productType))
      : [];
    const toCopy = allowed
      ? eligible.filter((s) => allowed.includes(s.itemVariant.item.category.productType))
      : eligible;

    await prisma.$transaction(async (tx) => {
      for (const s of toCopy) {
        await tx.locationItem.create({
          data: {
            locationId: location.id,
            itemVariantId: s.itemVariantId,
            cost: s.cost,
            retail: s.retail,
            parLevel: s.parLevel,
            updatedById: user.id,
          },
        });
      }
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "locationItem.copyFrom", entity: "Location", entityId: location.id,
          summary: `Copied ${toCopy.length} catalog item(s) from ${other.client.name} / ${other.name}`
            + (blockedByModule.length ? ` (${blockedByModule.length} skipped — outside this location's modules)` : ""),
          details: {
            sourceLocationId: otherId,
            copied: toCopy.length,
            skipped: source.length - toCopy.length,
            skippedByModule: blockedByModule.length,
          },
        },
        tx,
      );
    });
    return c.json({
      copied: toCopy.length,
      skipped: source.length - toCopy.length,
      skippedByModule: blockedByModule.length,
    });
  })

  // ── Suppliers (client-scoped) ──
  .get("/suppliers", async (c) => {
    const location = c.get("location");
    const suppliers = await prisma.supplier.findMany({
      where: { clientId: location.clientId },
      orderBy: { name: "asc" },
    });
    return c.json(suppliers);
  })
  .post("/suppliers", requirePermission("master.write"), zValidator("json", supplierUpsert), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          clientId: location.clientId,
          name: body.name,
          contactInfo: body.contactInfo ?? null,
          contactPerson: body.contactPerson ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
          address: body.address ?? null,
          paymentTerms: body.paymentTerms ?? null,
        },
      });
      await logActivity(
        { user, clientId: location.clientId, action: "supplier.create", entity: "Supplier", entityId: created.id, summary: `Added supplier ${created.name}` },
        tx,
      );
      return created;
    });
    return c.json(supplier, 201);
  })
  .put("/suppliers/:id", requirePermission("master.write"), zValidator("json", supplierUpsert.partial()), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const supplierId = c.req.param("id");
    const body = c.req.valid("json");
    const existing = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!existing || existing.clientId !== location.clientId) throw new AppError(404, "Supplier not found");
    const supplier = await prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id: supplierId }, data: body });
      await logActivity(
        { user, clientId: location.clientId, action: "supplier.update", entity: "Supplier", entityId: supplierId, summary: `Updated supplier ${updated.name}`, details: body },
        tx,
      );
      return updated;
    });
    return c.json(supplier);
  });
