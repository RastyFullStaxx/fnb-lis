import { Hono, type Context } from "hono";
import { zValidator } from "../lib/validate";
import { allowedProductTypes, isCostBasis, locationItemAttach, locationItemSchedule, locationItemUpdate, resolveBottleWeights, supplierUpsert, toCsv, type CostBasis, type CsvValue } from "@fnb/core";
import { clutterCandidates } from "../services/report-lists";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { assertNotQueuedEdit } from "../lib/two-way";
import { getTrailingAverage } from "../lib/weigh-history";
import { logActivity } from "../services/activity";
import { generateAssetCode } from "../services/asset-supplier";
import { requirePermission, type AppEnv } from "../middleware/auth";

const priceGuard = requirePermission("prices.edit");
const masterGuard = requirePermission("master.write");

/**
 * The client's saved inventory cost basis. Same policy as the reports —
 * the candidate list's cost value must not disagree with what Non-Moving
 * or the Full Audit show for the same item.
 */
function basisOf(c: Context<AppEnv>): CostBasis {
  const raw = (c.get("client") as { costBasis?: string } | undefined)?.costBasis;
  return isCostBasis(raw) ? raw : "PRICE";
}

/** Asset register fields writable through the shared catalog PUT. */
const ASSET_DETAIL_FIELDS = ["assetCode", "initialCost", "serialNo", "condition", "status", "remarks"] as const;

/** Did this partial update actually carry any of these fields? */
const touched = (body: Record<string, unknown>, keys: readonly string[]) =>
  keys.some((k) => body[k] !== undefined);

/** Mounted under /api/locations/:locationId (requireAuth + requireLocationAccess applied there). */
export const locationItemRoutes = new Hono<AppEnv>()
  /**
   * The establishment's own catalog WITH its bottle tare + liquid weights, as
   * CSV. The client weighs their own bottles (client decision 2026-07-25:
   * "sila na mag timbang… dapat din makita nila"), so this is their data to
   * take — it exports the LOCAL database, never the shared master library.
   */
  .get("/location-items/export", async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const rows = await prisma.locationItem.findMany({
      where: { locationId: location.id, isActive: true },
      include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      orderBy: { itemVariant: { item: { name: "asc" } } },
    });
    const csv = toCsv([
      ["Item", "Category", "Size", "Unit", "Cost", "Retail", "Par", "Empty (Tare) Weight", "Tare Unit", "Liquid Weight", "Source"],
      ...rows.map((r): CsvValue[] => [
        r.itemVariant.item.name,
        r.itemVariant.item.category.name,
        r.itemVariant.size,
        r.itemVariant.unit.name,
        r.cost,
        r.retail,
        r.parLevel ?? "",
        ...(() => {
          // Same resolution the count screen uses, so the file and the app can
          // never quote different weights.
          const w = resolveBottleWeights(r, r.itemVariant, r.itemVariant.item.category.defaultDensityFactor);
          return [w.tareWeight ?? "", w.tareWeightUnit ?? "", w.densityFactor ?? "", w.fromLocal ? "Own weighing" : "Standard"];
        })(),
      ]),
    ]);
    const name = `local-database_${location.name}`.replace(/[^\w.-]+/g, "-");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "X-Exported-By": `${user.firstName} ${user.lastName}`,
      },
    });
  })

  // ── Location catalog ──
  .get("/location-items", async (c) => {
    const location = c.get("location");
    const search = c.req.query("search")?.trim();
    const missingPrices = c.req.query("missingPrices") === "1";
    const items = await prisma.locationItem.findMany({
      where: {
        locationId: location.id,
        isActive: c.req.query("includeInactive") === "1" ? undefined : true,
        // Mirrors isMissingPrice(): Assets need a cost but never a retail
        // price, so the chip and this filter can't disagree.
        ...(missingPrices
          ? {
              OR: [
                { cost: { lte: 0 } },
                {
                  retail: { lte: 0 },
                  itemVariant: { item: { category: { productType: { not: "Asset" } } } },
                },
              ],
            }
          : {}),
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
      //
      // This writes cost and retail, so it is a price change and has to leave
      // the same trail as one. It previously did neither — no transaction, no
      // ActivityLog — which made "archive the item, re-add it at a different
      // cost" the one way to move a valuation input with nothing recorded,
      // while the create branch below and PUT /location-items/:id both log.
      const revived = await prisma.$transaction(async (tx) => {
        const row = await tx.locationItem.update({
          where: { id: exists.id },
          data: { isActive: true, cost: body.cost, retail: body.retail, parLevel: body.parLevel ?? null, updatedById: user.id },
          include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
        });
        await logActivity(
          {
            user, clientId: location.clientId, locationId: location.id,
            action: "locationItem.priceChange", entity: "LocationItem", entityId: row.id,
            summary: `Restored ${row.itemVariant.item.name} ${row.itemVariant.size} ${row.itemVariant.unit.name} to catalog (cost ${exists.cost} → ${body.cost}, retail ${exists.retail} → ${body.retail})`,
            // Same before/after shape PUT /location-items/:id records, so the
            // dashboard's price-change counter and the Activity filter pick
            // this up like any other price move.
            details: {
              old: { cost: exists.cost, retail: exists.retail, parLevel: exists.parLevel, isActive: false },
              new: { cost: body.cost, retail: body.retail, parLevel: body.parLevel ?? null, isActive: true },
            },
          },
          tx,
        );
        return row;
      });
      return c.json(revived, 200);
    }
    const created = await prisma.$transaction(async (tx) => {
      // Asset rows get their AST-### register code at attach time — the
      // sequence is client-wide, not per-category (2.5), so it must be read
      // and incremented inside this same transaction as the create.
      const assetCode =
        variant.item.category.productType === "Asset" ? await generateAssetCode(tx) : null;
      const li = await tx.locationItem.create({
        data: {
          locationId: location.id,
          itemVariantId: body.itemVariantId,
          cost: body.cost,
          retail: body.retail,
          parLevel: body.parLevel ?? null,
          assetCode,
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

  /**
   * Trailing average of this item's recent weigh counts at this location —
   * feeds the live weigh preview's history-based outlier check
   * (docs/2026-08-01-weight-outlier-warning-plan.md §3, §6; phases doc
   * Phase 3/4). Same query the server itself checks against at save time
   * (routes/counts.ts), so what the counter sees while typing can never
   * disagree with what gets logged when they save.
   *
   * `requireAuth` only — reading your own count history to sanity-check a
   * reading needs no special permission, same tier as reading the catalog.
   */
  .get("/location-items/:id/trailing-average", async (c) => {
    const location = c.get("location");
    const itemId = c.req.param("id");
    const existing = await prisma.locationItem.findUnique({ where: { id: itemId } });
    if (!existing || existing.locationId !== location.id) throw new AppError(404, "Catalog item not found");
    const trailingAverage = await getTrailingAverage(itemId);
    return c.json({ trailingAverage });
  })

  .put("/location-items/:id", priceGuard, zValidator("json", locationItemUpdate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const itemId = c.req.param("id");
    const body = c.req.valid("json");
    // Rule 3 (docs §7.2): cost and retail are the inputs to every valuation, so
    // a stale offline edit applying last-write-wins is how an establishment's
    // stated inventory value changes without anyone deciding to change it.
    await assertNotQueuedEdit(c, "Prices and weights");
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
          // One route, two very different edits — an auditor filtering for
          // weight changes must not have to read every price change.
          // One route, three very different edits — an auditor filtering for
          // weight or asset changes must not have to read every price change.
          action: touched(body, ["tareWeight", "tareWeightUnit", "densityFactor"])
            ? "locationItem.weightChange"
            : touched(body, ASSET_DETAIL_FIELDS)
              ? "locationItem.assetChange"
              : "locationItem.priceChange",
          entity: "LocationItem", entityId: itemId,
          summary: `Updated ${existing.itemVariant.item.name} ${existing.itemVariant.size} ${existing.itemVariant.unit.name}`,
          details: {
            // The BEFORE image has to cover every field this route can write,
            // or a change records its new value with nothing to compare it to.
            old: {
              cost: existing.cost, retail: existing.retail, parLevel: existing.parLevel, isActive: existing.isActive,
              // Weights change what a scale reading computes to, so an edit
              // must be as auditable as a price change.
              tareWeight: existing.tareWeight, tareWeightUnit: existing.tareWeightUnit, densityFactor: existing.densityFactor,
              // Asset register fields: condition and status drive the register
              // and the breakage report, so they need the same treatment.
              assetCode: existing.assetCode, initialCost: existing.initialCost, serialNo: existing.serialNo,
              condition: existing.condition, status: existing.status, remarks: existing.remarks,
            },
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
   * Hide a catalog item. Manual path from the clutter-item-removal plan: a
   * manager can act now, without waiting on a report. Sets isActive false so
   * the item drops off new counts, purchases, and menus; past reports keep
   * showing it as before (isActive is a visibility flag, never a delete).
   *
   * Blocked while the item is still in use: an open count, a live recipe
   * line, or stock in transit that has not been received. Clearing the link
   * first keeps every report and reconciliation consistent with what the
   * item's last real state actually was.
   */
  .post("/location-items/:id/hide", masterGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const itemId = c.req.param("id");
    const existing = await prisma.locationItem.findUnique({
      where: { id: itemId },
      include: { itemVariant: { include: { unit: true, item: true } } },
    });
    if (!existing || existing.locationId !== location.id) throw new AppError(404, "Catalog item not found");
    if (!existing.isActive) throw new AppError(409, "This item is already hidden");

    const openCount = await prisma.countLine.findFirst({
      where: { locationItemId: itemId, status: "ACTIVE", countSession: { status: "OPEN" } },
    });
    if (openCount) throw new AppError(409, "This item has an open count. Close or void the count first.");

    // Only the latest published version of each menu item is live — an item
    // referenced only by a superseded recipe version should not block a hide.
    // Same "latest version" read used for sales matching and the menu editor.
    const menuItemsUsingIt = await prisma.menuItem.findMany({
      where: { isActive: true, versions: { some: { lines: { some: { locationItemId: itemId } } } } },
      include: { versions: { orderBy: { versionNo: "desc" }, take: 1, include: { lines: true } } },
    });
    const recipeLine = menuItemsUsingIt.find((mi) =>
      mi.versions[0]?.lines.some((l) => l.locationItemId === itemId),
    );
    if (recipeLine) throw new AppError(409, "This item is used in an active recipe. Remove it from the recipe first.");

    const unresolvedTransfer = await prisma.transferLine.findFirst({
      where: {
        locationItemId: itemId,
        status: "ACTIVE",
        transfer: { status: { in: ["DRAFT", "COMMITTED"] } },
        receipts: { none: { status: "ACTIVE" } },
      },
    });
    if (unresolvedTransfer) throw new AppError(409, "This item has stock in transit that hasn't been received yet.");

    const updated = await prisma.$transaction(async (tx) => {
      const li = await tx.locationItem.update({
        where: { id: itemId },
        data: { isActive: false, updatedById: user.id },
        include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "locationItem.hide", entity: "LocationItem", entityId: itemId,
          summary: `Hid ${existing.itemVariant.item.name} ${existing.itemVariant.size} ${existing.itemVariant.unit.name} from catalog`,
          details: { old: { isActive: true }, new: { isActive: false } },
        },
        tx,
      );
      return li;
    });
    return c.json(updated);
  })

  /**
   * Restore a hidden catalog item. Same gate as hide, no link checks needed:
   * bringing something back is always safe.
   */
  .post("/location-items/:id/restore", masterGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const itemId = c.req.param("id");
    const existing = await prisma.locationItem.findUnique({
      where: { id: itemId },
      include: { itemVariant: { include: { unit: true, item: true } } },
    });
    if (!existing || existing.locationId !== location.id) throw new AppError(404, "Catalog item not found");
    if (existing.isActive) throw new AppError(409, "This item is not hidden");

    const updated = await prisma.$transaction(async (tx) => {
      const li = await tx.locationItem.update({
        where: { id: itemId },
        data: { isActive: true, updatedById: user.id },
        include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "locationItem.restore", entity: "LocationItem", entityId: itemId,
          summary: `Restored ${existing.itemVariant.item.name} ${existing.itemVariant.size} ${existing.itemVariant.unit.name} to catalog`,
          details: { old: { isActive: false }, new: { isActive: true } },
        },
        tx,
      );
      return li;
    });
    return c.json(updated);
  })

  /**
   * Set or clear the item's expected movement window, clutter-item-removal
   * plan Phase 4. Feeds the schedule check in the clutter-candidates read
   * (Phase 3): inside the window, no movement is a real signal; outside it,
   * the item is skipped. No schedule set falls back to the plain 12-month
   * lookback, no seasonal exception.
   */
  .put("/location-items/:id/schedule", masterGuard, zValidator("json", locationItemSchedule), async (c) => {
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
        data: { scheduleStartMonth: body.scheduleStartMonth, scheduleEndMonth: body.scheduleEndMonth, updatedById: user.id },
        include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "locationItem.scheduleChange", entity: "LocationItem", entityId: itemId,
          summary: `Updated movement schedule for ${existing.itemVariant.item.name} ${existing.itemVariant.size} ${existing.itemVariant.unit.name}`,
          details: {
            old: { scheduleStartMonth: existing.scheduleStartMonth, scheduleEndMonth: existing.scheduleEndMonth },
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
   * System-suggested removal candidates (clutter-item-removal plan, Phase 3).
   * Reuses the Non-Moving idle-stock read, computed on request, no scheduler.
   * A manager reviews this list and calls hide directly on whichever items
   * they approve; dismissing one is just not acting on it, no state change.
   */
  .get("/location-items/clutter-candidates", masterGuard, async (c) => {
    const location = c.get("location");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await clutterCandidates(location.id, allowed, basisOf(c)));
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
    await assertNotQueuedEdit(c, "Suppliers");
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
