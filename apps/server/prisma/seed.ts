import { prisma } from "../src/db";
import { hashPassword } from "../src/auth/password";
import { allowedProductTypes, derivePackageType } from "@fnb/core";

const PASSWORD = "Fnb!2026"; // documented demo password for all seeded roles

async function seedUsers() {
  const passwordHash = await hashPassword(PASSWORD);
  const users = [
    { username: "admin", firstName: "Lourd", lastName: "Borromeo", role: "ADMIN" },
    { username: "manager", firstName: "Maria", lastName: "Santos", role: "MANAGER" },
    { username: "staff", firstName: "Paolo", lastName: "Reyes", role: "STAFF" },
    { username: "accountant", firstName: "Grace", lastName: "Lim", role: "ACCOUNTANT" },
    { username: "readonly", firstName: "Vis", lastName: "Itor", role: "READONLY" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { role: u.role, status: "ACTIVE", passwordHash },
      create: { ...u, passwordHash, email: `${u.username}@fnb-lis.local` },
    });
  }
}

async function seedClients() {
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });

  // Subscription is mandatory at creation time (see POST /clients/full) — a
  // Client can never exist without one through the real app. Seed them
  // together per client so the seeded data matches that invariant instead
  // of drifting into a "client with no package" state the UI can't produce.
  //
  // Modules are now atomic rows (Fix Plan Phase C) rather than a combo
  // string — Prime is licensed for both BAR and KITCHEN; Casa Verde for
  // KITCHEN only.
  const prime = await upsertClientWithSubscription(
    "Prime Hospitality Group",
    { billingCycle: "MONTHLY", modules: ["BAR", "KITCHEN"], maxEntities: 5 },
    admin?.id,
  );
  // Prime legitimately splits one operation into two locations — "Main Bar"
  // (its own BAR module -> Beverage) and "Kitchen" (its own KITCHEN module ->
  // Food). This is the real, supported "one location per module" pattern
  // (packaging-model-fix-plan.md §1.2): each location's own LocationModule
  // set is a strict subset of Prime's {BAR, KITCHEN} subscription ceiling.
  await upsertLocationWithModules(prime.id, "Main Bar", ["BAR"]);
  await upsertLocationWithModules(prime.id, "Kitchen", ["KITCHEN"]);

  const casa = await upsertClientWithSubscription(
    "Casa Verde Restaurant",
    { billingCycle: "MONTHLY", modules: ["KITCHEN"], maxEntities: 1 },
    admin?.id,
  );
  // Casa Verde is Basic tier (1 location) — its single "Main" location
  // carries the client's whole module set (just {KITCHEN} here).
  await upsertLocationWithModules(casa.id, "Main", ["KITCHEN"]);

  // Non-admin users are scoped via UserClientAccess (ADMIN bypasses).
  const assign: Record<string, string[]> = {
    manager: [prime.id, casa.id],
    staff: [prime.id],
    accountant: [prime.id],
    readonly: [prime.id],
  };
  for (const [username, clientIds] of Object.entries(assign)) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) continue;
    for (const clientId of clientIds) {
      await prisma.userClientAccess.upsert({
        where: { userId_clientId: { userId: user.id, clientId } },
        update: {},
        create: { userId: user.id, clientId },
      });
    }
  }
}

async function upsertClientWithSubscription(
  name: string,
  sub: { billingCycle: "MONTHLY" | "STANDALONE"; modules: readonly string[]; maxEntities: number },
  createdById?: string,
) {
  const existing = await prisma.client.findFirst({ where: { name } });
  if (existing) return existing;

  const client = await prisma.client.create({ data: { name } });
  await prisma.subscription.create({
    data: {
      clientId: client.id,
      packageType: derivePackageType(sub.billingCycle, sub.maxEntities),
      billingCycle: sub.billingCycle,
      maxEntities: sub.maxEntities,
      status: "ACTIVE",
      startDate: "2026-01-01",
      createdById: createdById ?? null,
      paid: false,
      lastPaidAt: null,
      modules: { create: sub.modules.map((module) => ({ module })) },
    },
  });
  return client;
}

async function upsertLocation(clientId: string, name: string) {
  const existing = await prisma.location.findFirst({ where: { clientId, name } });
  return existing ?? prisma.location.create({ data: { clientId, name } });
}

/**
 * Creates (or reuses) a location and ensures its LocationModule set matches
 * `modules` exactly. Callers are responsible for keeping `modules` a subset
 * of the client's SubscriptionModule ceiling — the same rule the real
 * /admin API enforces at write time (Fix Plan §2.3).
 */
async function upsertLocationWithModules(clientId: string, name: string, modules: readonly string[]) {
  const location = await upsertLocation(clientId, name);
  for (const module of modules) {
    await prisma.locationModule.upsert({
      where: { locationId_module: { locationId: location.id, module } },
      update: {},
      create: { locationId: location.id, module },
    });
  }
  return location;
}

async function seedUnits() {
  // Base units: VOLUME → ml, MASS → g, COUNT → 1
  const units: Array<{ name: string; kind: string; factorToBase: number }> = [
    { name: "ml", kind: "VOLUME", factorToBase: 1 },
    { name: "L", kind: "VOLUME", factorToBase: 1000 },
    { name: "fl oz", kind: "VOLUME", factorToBase: 29.5735 },
    { name: "gal", kind: "VOLUME", factorToBase: 3785.41 },
    { name: "g", kind: "MASS", factorToBase: 1 },
    { name: "kg", kind: "MASS", factorToBase: 1000 },
    { name: "oz", kind: "MASS", factorToBase: 28.3495 },
    { name: "lb", kind: "MASS", factorToBase: 453.592 },
    { name: "pc", kind: "COUNT", factorToBase: 1 },
    { name: "bottle", kind: "COUNT", factorToBase: 1 },
    { name: "pack", kind: "COUNT", factorToBase: 1 },
    { name: "case", kind: "COUNT", factorToBase: 1 },
    { name: "box", kind: "COUNT", factorToBase: 1 },
    { name: "tray", kind: "COUNT", factorToBase: 1 },
    { name: "can", kind: "COUNT", factorToBase: 1 },
    { name: "dozen", kind: "COUNT", factorToBase: 12 },
  ];
  for (const u of units) {
    await prisma.unit.upsert({
      where: { name: u.name },
      update: { kind: u.kind, factorToBase: u.factorToBase },
      create: { ...u, isSystem: true },
    });
  }
}

async function seedCategories() {
  const categories: Array<{ name: string; productType: string; defaultDensityFactor?: number; sortOrder: number }> = [
    { name: "Vodka", productType: "Beverage", defaultDensityFactor: 30.12, sortOrder: 1 },
    { name: "Rum", productType: "Beverage", defaultDensityFactor: 30.49, sortOrder: 2 },
    { name: "Whisky", productType: "Beverage", defaultDensityFactor: 30.86, sortOrder: 3 },
    { name: "Gin", productType: "Beverage", defaultDensityFactor: 30.49, sortOrder: 4 },
    { name: "Brandy", productType: "Beverage", defaultDensityFactor: 30.3, sortOrder: 5 },
    { name: "Tequila", productType: "Beverage", defaultDensityFactor: 30.67, sortOrder: 6 },
    { name: "Single Malt Whisky", productType: "Beverage", defaultDensityFactor: 30.12, sortOrder: 7 },
    { name: "Cognac", productType: "Beverage", defaultDensityFactor: 30.67, sortOrder: 8 },
    { name: "Bourbon", productType: "Beverage", defaultDensityFactor: 30.86, sortOrder: 9 },
    { name: "Aperitif", productType: "Beverage", defaultDensityFactor: 28.9, sortOrder: 10 },
    { name: "Liqueur", productType: "Beverage", sortOrder: 11 },
    { name: "Wine", productType: "Beverage", sortOrder: 12 },
    { name: "Beer", productType: "Beverage", sortOrder: 13 },
    { name: "Soda & Mixers", productType: "Beverage", sortOrder: 14 },
    { name: "Juices", productType: "Beverage", sortOrder: 15 },
    { name: "Syrup", productType: "Beverage", sortOrder: 16 },
    { name: "Meat", productType: "Food", sortOrder: 20 },
    { name: "Poultry", productType: "Food", sortOrder: 21 },
    { name: "Seafood", productType: "Food", sortOrder: 22 },
    { name: "Dairy", productType: "Food", sortOrder: 23 },
    { name: "Produce", productType: "Food", sortOrder: 24 },
    { name: "Dry Goods", productType: "Food", sortOrder: 25 },
    { name: "Frozen", productType: "Food", sortOrder: 26 },
    { name: "Sauces & Dressings", productType: "Food", sortOrder: 27 },
    { name: "Consumables", productType: "Supplies", sortOrder: 30 },
    // Asset now has its own real product type (Fix Plan Phase E) — equipment,
    // tools, and other non-consumable items, distinct from the consumable
    // Supplies above (Table Napkins, Disposable Gloves).
    { name: "Equipment", productType: "Asset", sortOrder: 40 },
  ];
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {
        productType: cat.productType,
        defaultDensityFactor: cat.defaultDensityFactor ?? null,
        sortOrder: cat.sortOrder,
      },
      create: { ...cat, defaultDensityFactor: cat.defaultDensityFactor ?? null },
    });
  }
}

async function seedSettings() {
  const settings: Array<{ key: string; value: unknown }> = [
    { key: "productTypes", value: ["Beverage", "Food", "Supplies", "Asset"] },
    { key: "company", value: { name: "Liquor Inventory Solution", shortName: "LIS" } },
  ];
  for (const s of settings) {
    await prisma.setting.upsert({
      where: { clientId_key: { clientId: "", key: s.key } },
      update: { value: JSON.stringify(s.value) },
      create: { clientId: "", key: s.key, value: JSON.stringify(s.value) },
    });
  }
}

interface SeedVariant {
  size: number;
  unit: string;
  contentTracked?: boolean;
  tareWeight?: number;
  densityFactor?: number;
  barcode?: string;
}

const ITEMS: Array<{ name: string; category: string; variants: SeedVariant[] }> = [
  {
    name: "Absolut Vodka",
    category: "Vodka",
    variants: [
      { size: 700, unit: "ml", contentTracked: true, tareWeight: 16.9 },
      { size: 1000, unit: "ml", contentTracked: true, tareWeight: 19.4 },
    ],
  },
  { name: "Jack Daniel's Old No. 7", category: "Whisky", variants: [{ size: 700, unit: "ml", contentTracked: true, tareWeight: 17.2 }] },
  { name: "Bacardi Superior", category: "Rum", variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 16.5 }] },
  { name: "Bombay Sapphire", category: "Gin", variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 21.2 }] },
  { name: "Jose Cuervo Especial", category: "Tequila", variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 17.6 }] },
  { name: "San Miguel Pale Pilsen", category: "Beer", variants: [{ size: 330, unit: "ml" }] },
  { name: "Tonic Water", category: "Soda & Mixers", variants: [{ size: 200, unit: "ml" }] },
  { name: "Cola", category: "Soda & Mixers", variants: [{ size: 1, unit: "L" }] },
  { name: "Orange Juice", category: "Juices", variants: [{ size: 1, unit: "L" }] },
  { name: "House Red Wine", category: "Wine", variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 15.8 }] },
  {
    name: "Grenadine Syrup",
    category: "Syrup",
    variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 15.0, densityFactor: 25.0 }],
  },
  { name: "Chicken Breast", category: "Poultry", variants: [{ size: 1, unit: "kg" }] },
  { name: "Ribeye Steak", category: "Meat", variants: [{ size: 1, unit: "kg" }] },
  { name: "Salmon Fillet", category: "Seafood", variants: [{ size: 1, unit: "kg" }] },
  { name: "Butter", category: "Dairy", variants: [{ size: 1, unit: "kg" }] },
  { name: "Lime", category: "Produce", variants: [{ size: 1, unit: "pc" }] },
  { name: "Potato Fries", category: "Frozen", variants: [{ size: 1, unit: "kg" }] },
  { name: "Cooking Oil", category: "Dry Goods", variants: [{ size: 1, unit: "L" }] },
  { name: "Table Napkins", category: "Consumables", variants: [{ size: 1, unit: "pack" }] },
  { name: "Disposable Gloves", category: "Consumables", variants: [{ size: 1, unit: "box" }] },
  // Asset catalog (Fix Plan Phase E) — non-consumable equipment, tracked as
  // whole units rather than restocked like Beverage/Food/Supplies.
  { name: "Bar Blender", category: "Equipment", variants: [{ size: 1, unit: "pc" }] },
  { name: "Commercial Ice Machine", category: "Equipment", variants: [{ size: 1, unit: "pc" }] },
];

type PriceRow = [string, number, string, number, number, number?];

const MAIN_BAR_PRICES: PriceRow[] = [
  ["Absolut Vodka", 700, "ml", 620, 1650, 10],
  ["Absolut Vodka", 1000, "ml", 850, 2200, 6],
  ["Jack Daniel's Old No. 7", 700, "ml", 950, 2400, 6],
  ["Bacardi Superior", 750, "ml", 550, 1400, 8],
  ["Bombay Sapphire", 750, "ml", 1100, 2600, 5],
  ["Jose Cuervo Especial", 750, "ml", 890, 2200, 5],
  ["House Red Wine", 750, "ml", 420, 1250, 8],
  ["San Miguel Pale Pilsen", 330, "ml", 45, 120, 48],
  ["Tonic Water", 200, "ml", 30, 90, 24],
  ["Cola", 1, "L", 42, 120, 12],
  ["Orange Juice", 1, "L", 80, 180, 10],
  ["Grenadine Syrup", 750, "ml", 180, 0],
  // NOTE: Lime (Produce -> Food) and Table Napkins (Consumables -> Supplies)
  // were removed from this list — Main Bar's LocationModule is {BAR}, which
  // only allows Beverage (see assertLocationCatalogWithinModules). Both are
  // real bar-side items in practice, but under this single-productType-per-
  // category model they can't be stocked on a Bar-only location without
  // either a Kitchen/Supplies module on Main Bar too, or a dedicated
  // "garnish"/"barware" categorization decision — out of scope for the seed
  // fix; keeping Main Bar strictly Beverage-only here.
];

const KITCHEN_PRICES: PriceRow[] = [
  ["Chicken Breast", 1, "kg", 180, 320, 12],
  ["Ribeye Steak", 1, "kg", 780, 1450, 5],
  ["Salmon Fillet", 1, "kg", 620, 1180, 4],
  ["Butter", 1, "kg", 320, 480, 3],
  ["Potato Fries", 1, "kg", 110, 240, 10],
  ["Cooking Oil", 1, "L", 95, 160, 8],
  // NOTE: Disposable Gloves (Consumables -> Supplies) removed — this list
  // seeds both Prime's "Kitchen" and Casa Verde's "Main", and both locations'
  // LocationModule is {KITCHEN}, which only allows Food (see
  // assertLocationCatalogWithinModules). Same reasoning as the Main Bar note
  // above.
];

async function seedItems() {
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  for (const def of ITEMS) {
    const category = await prisma.category.findUnique({ where: { name: def.category } });
    if (!category) continue;
    let item = await prisma.item.findFirst({ where: { name: def.name } });
    if (!item) {
      item = await prisma.item.create({
        data: { name: def.name, categoryId: category.id, createdById: admin?.id },
      });
    }
    for (const v of def.variants) {
      const unit = await prisma.unit.findUnique({ where: { name: v.unit } });
      if (!unit) continue;
      await prisma.itemVariant.upsert({
        where: { itemId_size_unitId: { itemId: item.id, size: v.size, unitId: unit.id } },
        update: {},
        create: {
          itemId: item.id,
          size: v.size,
          unitId: unit.id,
          contentTracked: v.contentTracked ?? false,
          tareWeight: v.tareWeight ?? null,
          tareWeightUnit: v.tareWeight ? "oz" : null,
          densityFactor: v.densityFactor ?? null,
          barcode: v.barcode ?? null,
        },
      });
    }
  }
}

async function seedLocationCatalog(clientName: string, locationName: string, prices: PriceRow[]) {
  const location = await prisma.location.findFirst({
    where: { name: locationName, client: { name: clientName } },
  });
  if (!location) return;
  for (const [itemName, size, unitName, cost, retail, parLevel] of prices) {
    const variant = await prisma.itemVariant.findFirst({
      where: { size, item: { name: itemName }, unit: { name: unitName } },
    });
    if (!variant) continue;
    await prisma.locationItem.upsert({
      where: { locationId_itemVariantId: { locationId: location.id, itemVariantId: variant.id } },
      update: { cost, retail, parLevel: parLevel ?? null },
      create: { locationId: location.id, itemVariantId: variant.id, cost, retail, parLevel: parLevel ?? null },
    });
  }
}

/**
 * Phase C guardrail (packaging-model-fix-plan.md §3 Phase F / acceptance
 * criteria): fail the seed loudly if any LocationItem's Category.productType
 * falls outside what that *location's own* LocationModule set allows — the
 * enforced reality, not just the client's subscription ceiling. This is the
 * layer that actually matters; Casa Verde's original bug (Beverage items on
 * a Kitchen-only "Main" location) is now structurally impossible to seed
 * silently, whether or not the location's name happens to hint at its module.
 */
async function assertLocationCatalogWithinModules(clientName: string, locationName: string) {
  const location = await prisma.location.findFirst({
    where: { name: locationName, client: { name: clientName } },
    include: {
      modules: true,
      locationItems: {
        include: { itemVariant: { include: { item: { include: { category: true } } } } },
      },
    },
  });
  if (!location) return;

  const modules = location.modules.map((m) => m.module);
  const allowed = allowedProductTypes(modules);
  if (!allowed) return; // no modules assigned -> unrestricted, nothing to assert

  const offenders = location.locationItems
    .map((li) => ({
      itemName: li.itemVariant.item.name,
      productType: li.itemVariant.item.category.productType,
    }))
    .filter((row) => !allowed.includes(row.productType));

  if (offenders.length > 0) {
    const detail = offenders.map((o) => `${o.itemName} (${o.productType})`).join(", ");
    throw new Error(
      `Seed assertion failed: location "${locationName}" (${clientName}) has modules ` +
        `[${modules.join(", ")}] (allows [${allowed.join(", ")}]) but is stocked with items ` +
        `outside that: ${detail}. Fix the seed data for this location before continuing.`,
    );
  }
}

async function seedSuppliers() {
  const prime = await prisma.client.findFirst({ where: { name: "Prime Hospitality Group" } });
  if (!prime) return;
  for (const name of ["Metro Beverage Distribution", "FreshFoods Corp", "Island Meat & Seafood", "Bar Essentials Supply"]) {
    const exists = await prisma.supplier.findFirst({ where: { clientId: prime.id, name } });
    if (!exists) await prisma.supplier.create({ data: { clientId: prime.id, name } });
  }
}

async function seedGoldenCycle() {
  const location = await prisma.location.findFirst({
    where: { name: "Main Bar", client: { name: "Prime Hospitality Group" } },
  });
  const staff = await prisma.user.findUnique({ where: { username: "staff" } });
  const manager = await prisma.user.findUnique({ where: { username: "manager" } });
  if (!location || !staff || !manager) return;

  const existing = await prisma.countSession.findFirst({
    where: { locationId: location.id, countDate: "2026-06-01" },
  });
  if (existing) return;

  const li = async (itemName: string, size: number) => {
    const row = await prisma.locationItem.findFirst({
      where: { locationId: location.id, itemVariant: { size, item: { name: itemName } } },
      include: { itemVariant: true },
    });
    if (!row) throw new Error(`Golden cycle: missing location item ${itemName} ${size}`);
    return row;
  };

  const absolut = await li("Absolut Vodka", 700);
  const jd = await li("Jack Daniel's Old No. 7", 700);
  const beer = await li("San Miguel Pale Pilsen", 330);
  const tonic = await li("Tonic Water", 200);
  const supplier = await prisma.supplier.findFirst({ where: { name: "Metro Beverage Distribution" } });

  const encoder = { createdById: staff.id, createdByName: "Paolo Reyes" };

  const weigh = (scale: number, tare: number, density: number) => {
    const scaled = Number(((scale - tare) * density).toPrecision(15));
    return scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  };

  const countSession = async (
    countDate: string,
    lines: Array<
      | { item: typeof absolut; full: number }
      | { item: typeof absolut; scale: number; tare: number; density: number }
    >,
  ) => {
    const session = await prisma.countSession.create({
      data: { locationId: location.id, countDate, status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...encoder },
    });
    for (const line of lines) {
      if ("full" in line) {
        await prisma.countLine.create({
          data: {
            countSessionId: session.id, locationItemId: line.item.id, countType: "FULL",
            qtyFull: line.full, unitCost: line.item.cost, unitRetail: line.item.retail, ...encoder,
          },
        });
      } else {
        await prisma.countLine.create({
          data: {
            countSessionId: session.id, locationItemId: line.item.id, countType: "WEIGH",
            scaleWeight: line.scale, scaleUnit: "oz", tareWeight: line.tare, densityFactor: line.density,
            remainingContent: weigh(line.scale, line.tare, line.density),
            unitCost: line.item.cost, unitRetail: line.item.retail, ...encoder,
          },
        });
      }
    }
  };

  await countSession("2026-06-01", [
    { item: absolut, full: 12 },
    { item: absolut, scale: 28.7, tare: 16.9, density: 30.12 },
    { item: jd, full: 8 },
    { item: jd, scale: 25.0, tare: 17.2, density: 30.86 },
    { item: beer, full: 48 },
    { item: tonic, full: 24 },
  ]);

  const purchase = await prisma.purchase.create({
    data: {
      locationId: location.id, purchaseDate: "2026-06-03", supplierId: supplier?.id ?? null,
      refNo: "INV-8841", status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...encoder,
    },
  });
  const pline = (item: typeof absolut, qty: number, unitCost: number) =>
    prisma.purchaseLine.create({
      data: { purchaseId: purchase.id, locationItemId: item.id, qty, unitCost, lineTotal: qty * unitCost, ...encoder },
    });
  await pline(absolut, 6, 615);
  await pline(beer, 24, 44);
  await pline(tonic, 12, 30);

  const sale = (
    item: typeof absolut, saleDate: string, kind: string, qty: number, unitPrice: number,
    extra: { contentOverride?: number; reason?: string } = {},
  ) =>
    prisma.saleRecord.create({
      data: {
        locationId: location.id, saleDate, kind, locationItemId: item.id, qty, unitPrice,
        contentOverride: extra.contentOverride ?? null, reason: extra.reason ?? null, ...encoder,
      },
    });
  await sale(absolut, "2026-06-02", "SALE", 2, 1650);
  await sale(absolut, "2026-06-04", "SALE", 1, 1650);
  await sale(beer, "2026-06-04", "SALE", 30, 120);
  await sale(jd, "2026-06-05", "SALE", 2, 2400);
  await sale(tonic, "2026-06-06", "SALE", 8, 90);
  await sale(absolut, "2026-06-05", "NON_REVENUE", 1, 0, { contentOverride: 350, reason: "STAFF_USE" });
  await sale(beer, "2026-06-06", "NON_REVENUE", 2, 0, { reason: "SPILLAGE" });
  await sale(tonic, "2026-06-05", "PRODUCTION", 4, 0);

  await prisma.forfeit.create({
    data: {
      locationId: location.id, forfeitDate: "2026-06-06", locationItemId: absolut.id,
      scaleWeight: 25.4, scaleUnit: "oz", tareWeight: 16.9, densityFactor: 30.12,
      remainingContent: weigh(25.4, 16.9, 30.12),
      note: "Customer left unfinished bottle (table 7)", ...encoder,
    },
  });

  const vodkaTonic = await prisma.menuItem.create({
    data: { locationId: location.id, name: "Vodka Tonic" },
  });
  const vtV1 = await prisma.recipeVersion.create({
    data: {
      menuItemId: vodkaTonic.id,
      versionNo: 1,
      srp: 250,
      costAtPublish: (45 / 700) * absolut.cost + 1 * tonic.cost,
      publishedById: manager.id,
      lines: {
        create: [
          { locationItemId: absolut.id, servingQty: 45, sortOrder: 0 },
          { locationItemId: tonic.id, servingQty: 1, sortOrder: 1 },
        ],
      },
    },
  });

  const menuSale = (saleDate: string, kind: string, qty: number, unitPrice: number, discountPct = 0, reason?: string) =>
    prisma.saleRecord.create({
      data: {
        locationId: location.id, saleDate, kind, menuItemId: vodkaTonic.id, recipeVersionId: vtV1.id,
        qty, unitPrice, discountPct, reason: reason ?? null, ...encoder,
      },
    });
  await menuSale("2026-06-04", "SALE", 12, 250);
  await menuSale("2026-06-05", "SALE", 2, 250, 10);
  await menuSale("2026-06-06", "NON_REVENUE", 1, 0, 0, "STAFF_USE");

  await countSession("2026-06-08", [
    { item: absolut, full: 14 },
    { item: absolut, scale: 22.6, tare: 16.9, density: 30.12 },
    { item: jd, full: 6 },
    { item: jd, scale: 21.3, tare: 17.2, density: 30.86 },
    { item: beer, full: 39 },
    { item: tonic, full: 8 },
  ]);

  console.log("Golden cycle seeded (2026-06-01 → 2026-06-08 at Main Bar).");
}

/**
 * Phase-9 transfer fixture (docs/golden-fixtures.md §2): Main Bar dispatches 10 San
 * Miguel to a new "Depot" stockroom on 2026-06-10; the Depot confirms only 8
 * (2 broken in transit). All activity is dated ≥ 2026-06-10 so the sacred
 * phase-3 golden window [2026-06-01, 2026-06-08) is untouched.
 *
 * Hand-computed expectations (re-derive before trusting):
 *   Main Bar [06-08 → 06-15): usage(beer) = 39 + 0 + 0 + 0 + 0 − 10 − 29 = 0;
 *     expected 0 → variance 0. Other items counted identically → variance 0.
 *   Depot   [06-08 → 06-15): usage(beer) = 0 + 0 + 0 + 8 − 0 − 7 = 1;
 *     expected 1 (one sale @120) → variance 0, revenue 120.
 *   Transfer Out (Main Bar): 10 units, 450 at cost (10 × 45), 1,200 at retail.
 *   Transfer In  (Depot):     8 units, 360 at cost,             960 at retail.
 *   The 2-unit / ₱90-at-cost gap appears ONLY as Out(10) vs In(8) — deliberately
 *   unexplained anywhere else; that visibility is the point of the linked design.
 */
async function seedTransferFixture() {
  const prime = await prisma.client.findFirst({ where: { name: "Prime Hospitality Group" } });
  const mainBar = await prisma.location.findFirst({ where: { name: "Main Bar", clientId: prime?.id } });
  const staff = await prisma.user.findUnique({ where: { username: "staff" } });
  const manager = await prisma.user.findUnique({ where: { username: "manager" } });
  if (!prime || !mainBar || !staff || !manager) return;

  const depot = await upsertLocationWithModules(prime.id, "Depot", ["BAR"]);
  if (depot.kind !== "STOCKROOM") {
    await prisma.location.update({ where: { id: depot.id }, data: { kind: "STOCKROOM" } });
  }
  await seedLocationCatalog("Prime Hospitality Group", "Depot", [
    ["San Miguel Pale Pilsen", 330, "ml", 45, 120],
  ]);
  await assertLocationCatalogWithinModules("Prime Hospitality Group", "Depot");

  const existing = await prisma.transfer.findFirst({
    where: { fromLocationId: mainBar.id, toLocationId: depot.id, businessDate: "2026-06-10" },
  });
  if (existing) return;

  const encoder = { createdById: staff.id, createdByName: "Paolo Reyes" };
  const li = async (locationId: string, itemName: string, size: number) => {
    const row = await prisma.locationItem.findFirst({
      where: { locationId, itemVariant: { size, item: { name: itemName } } },
    });
    if (!row) throw new Error(`Transfer fixture: missing location item ${itemName} ${size}`);
    return row;
  };
  const barBeer = await li(mainBar.id, "San Miguel Pale Pilsen", 330);
  const depotBeer = await li(depot.id, "San Miguel Pale Pilsen", 330);

  // The transfer: committed at the source, then received short at the Depot.
  const transfer = await prisma.transfer.create({
    data: {
      fromLocationId: mainBar.id,
      toLocationId: depot.id,
      businessDate: "2026-06-10",
      status: "COMMITTED",
      committedAt: new Date(),
      committedById: manager.id,
      ...encoder,
    },
  });
  const line = await prisma.transferLine.create({
    data: {
      transferId: transfer.id,
      locationItemId: barBeer.id,
      qty: 10,
      unitCost: barBeer.cost,
      lineTotal: 10 * barBeer.cost,
      ...encoder,
    },
  });
  await prisma.transferReceiptLine.create({
    data: {
      transferLineId: line.id,
      toLocationItemId: depotBeer.id,
      qtyReceived: 8,
      receiptDate: "2026-06-10",
      note: "2 bottles broken in transit",
      ...encoder,
    },
  });

  // Depot boundary counts: a zero opening count on 06-08 (new location) and
  // the 06-15 closing count of 7 after one sale.
  const depotCount = async (countDate: string, qtyFull: number) => {
    const session = await prisma.countSession.create({
      data: { locationId: depot.id, countDate, status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...encoder },
    });
    await prisma.countLine.create({
      data: {
        countSessionId: session.id, locationItemId: depotBeer.id, countType: "FULL",
        qtyFull, unitCost: depotBeer.cost, unitRetail: depotBeer.retail, ...encoder,
      },
    });
  };
  await depotCount("2026-06-08", 0);
  await prisma.saleRecord.create({
    data: {
      locationId: depot.id, saleDate: "2026-06-12", kind: "SALE",
      locationItemId: depotBeer.id, qty: 1, unitPrice: 120, ...encoder,
    },
  });
  await depotCount("2026-06-15", 7);

  // Main Bar closing count on 06-15: beer down by the 10 transferred; every
  // other golden-cycle item repeats its 06-08 value → zero variance across
  // the board for the [06-08 → 06-15) window.
  const absolut = await li(mainBar.id, "Absolut Vodka", 700);
  const jd = await li(mainBar.id, "Jack Daniel's Old No. 7", 700);
  const tonic = await li(mainBar.id, "Tonic Water", 200);
  const weigh = (scale: number, tare: number, density: number) => {
    const scaled = Number(((scale - tare) * density).toPrecision(15));
    return scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  };
  const session = await prisma.countSession.create({
    data: { locationId: mainBar.id, countDate: "2026-06-15", status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...encoder },
  });
  const full = (item: { id: string; cost: number; retail: number }, qtyFull: number) =>
    prisma.countLine.create({
      data: { countSessionId: session.id, locationItemId: item.id, countType: "FULL", qtyFull, unitCost: item.cost, unitRetail: item.retail, ...encoder },
    });
  const weighLine = (item: { id: string; cost: number; retail: number }, scale: number, tare: number, density: number) =>
    prisma.countLine.create({
      data: {
        countSessionId: session.id, locationItemId: item.id, countType: "WEIGH",
        scaleWeight: scale, scaleUnit: "oz", tareWeight: tare, densityFactor: density,
        remainingContent: weigh(scale, tare, density),
        unitCost: item.cost, unitRetail: item.retail, ...encoder,
      },
    });
  await full(absolut, 14);
  await weighLine(absolut, 22.6, 16.9, 30.12);
  await full(jd, 6);
  await weighLine(jd, 21.3, 17.2, 30.86);
  await full(barBeer, 29);
  await full(tonic, 8);

  console.log("Transfer fixture seeded (Main Bar → Depot, 10 sent / 8 received, 2026-06-10).");
}

function normalizeAlias(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function demoActor(username = "staff") {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`Missing seed user ${username}`);
  return { id: user.id, name: `${user.firstName} ${user.lastName}` };
}

async function demoLocation(clientName: string, locationName: string) {
  const location = await prisma.location.findFirst({ where: { name: locationName, client: { name: clientName } } });
  if (!location) throw new Error(`Missing seed location ${clientName} / ${locationName}`);
  return location;
}

async function demoLocationItem(locationId: string, itemName: string, size: number) {
  const item = await prisma.locationItem.findFirst({
    where: { locationId, itemVariant: { size, item: { name: itemName } } },
    include: { itemVariant: true },
  });
  if (!item) throw new Error(`Missing seed location item ${itemName} ${size}`);
  return item;
}

async function seedAliases() {
  const location = await demoLocation("Prime Hospitality Group", "Main Bar");
  const rows: Array<[string, string, number]> = [
    ["ABSOLUT 700ML", "Absolut Vodka", 700],
    ["JD 700", "Jack Daniel's Old No. 7", 700],
    ["SMB Pale", "San Miguel Pale Pilsen", 330],
    ["Schweppes Tonic", "Tonic Water", 200],
  ];
  for (const [alias, itemName, size] of rows) {
    const locationItem = await demoLocationItem(location.id, itemName, size);
    await prisma.itemAlias.upsert({
      where: { clientId_aliasNormalized: { clientId: location.clientId, aliasNormalized: normalizeAlias(alias) } },
      update: { locationItemId: locationItem.id, menuItemId: null, source: "MANUAL" },
      create: { clientId: location.clientId, aliasNormalized: normalizeAlias(alias), locationItemId: locationItem.id, source: "MANUAL" },
    });
  }
}

async function seedOpenWork() {
  const location = await demoLocation("Prime Hospitality Group", "Main Bar");
  const staff = await demoActor("staff");
  const existingCount = await prisma.countSession.findFirst({ where: { locationId: location.id, countDate: "2026-06-10", status: "OPEN" } });
  if (!existingCount) {
    const absolut = await demoLocationItem(location.id, "Absolut Vodka", 700);
    const beer = await demoLocationItem(location.id, "San Miguel Pale Pilsen", 330);
    await prisma.countSession.create({
      data: {
        locationId: location.id,
        countDate: "2026-06-10",
        name: "Mid-week spot check",
        status: "OPEN",
        note: "Seeded open count for workflow review",
        createdById: staff.id,
        createdByName: staff.name,
        lines: {
          create: [
            { locationItemId: absolut.id, countType: "FULL", qtyFull: 3, unitCost: absolut.cost, unitRetail: absolut.retail, createdById: staff.id, createdByName: staff.name },
            { locationItemId: beer.id, countType: "FULL", qtyFull: 18, unitCost: beer.cost, unitRetail: beer.retail, createdById: staff.id, createdByName: staff.name },
          ],
        },
      },
    });
  }

  const existingPurchase = await prisma.purchase.findFirst({ where: { locationId: location.id, refNo: "DRAFT-BAR-001" } });
  if (!existingPurchase) {
    const supplier = await prisma.supplier.findFirst({ where: { name: "Bar Essentials Supply" } });
    const cola = await demoLocationItem(location.id, "Cola", 1);
    await prisma.purchase.create({
      data: {
        locationId: location.id,
        supplierId: supplier?.id ?? null,
        refNo: "DRAFT-BAR-001",
        purchaseDate: "2026-06-09",
        status: "DRAFT",
        note: "Seeded draft purchase for review",
        createdById: staff.id,
        createdByName: staff.name,
        lines: { create: [{ locationItemId: cola.id, qty: 12, unitCost: cola.cost, lineTotal: 12 * cola.cost, createdById: staff.id, createdByName: staff.name }] },
      },
    });
  }
}

async function seedImportBatches() {
  const location = await demoLocation("Prime Hospitality Group", "Main Bar");
  const staff = await demoActor("staff");
  const existing = await prisma.importBatch.findFirst({ where: { locationId: location.id, fileName: "pos-sales-review.csv" } });
  if (existing) return;
  const absolut = await demoLocationItem(location.id, "Absolut Vodka", 700);
  const beer = await demoLocationItem(location.id, "San Miguel Pale Pilsen", 330);
  const tonic = await demoLocationItem(location.id, "Tonic Water", 200);
  await prisma.importBatch.create({
    data: {
      locationId: location.id,
      kind: "SALES",
      fileName: "pos-sales-review.csv",
      fileSha256: "seed-pos-sales-review",
      storedPath: "seed://pos-sales-review.csv",
      sourceType: "CSV",
      extractor: "DETERMINISTIC",
      status: "NEEDS_REVIEW",
      businessDate: "2026-06-09",
      createdById: staff.id,
      createdByName: staff.name,
      rows: {
        create: [
          { rowIndex: 0, rawJson: JSON.stringify({ item: "ABSOLUT 700ML", qty: 2, price: 1650 }), itemText: "ABSOLUT 700ML", qty: 2, unitPrice: 1650, rowDate: "2026-06-09", matchedLocationItemId: absolut.id, matchMethod: "ALIAS", confidence: 0.96, status: "APPROVED" },
          { rowIndex: 1, rawJson: JSON.stringify({ item: "SMB Pale", qty: 24, price: 120 }), itemText: "SMB Pale", qty: 24, unitPrice: 120, rowDate: "2026-06-09", matchedLocationItemId: beer.id, matchMethod: "ALIAS", confidence: 0.94, status: "APPROVED" },
          { rowIndex: 2, rawJson: JSON.stringify({ item: "Mystery Comp", qty: 1 }), itemText: "Mystery Comp", qty: 1, rowDate: "2026-06-09", confidence: 0.28, warning: "No confident match. Choose an item or reject.", status: "PENDING" },
          { rowIndex: 3, rawJson: JSON.stringify({ item: "Tonic Water", qty: 4, price: 90 }), itemText: "Tonic Water", qty: 4, unitPrice: 90, rowDate: "2026-06-09", matchedLocationItemId: tonic.id, matchMethod: "EXACT", confidence: 1, status: "REJECTED", warning: "Duplicate POS line" },
        ],
      },
    },
  });

  await prisma.importBatch.create({
    data: {
      locationId: location.id,
      kind: "PURCHASES",
      fileName: "supplier-invoice-8897.xlsx",
      fileSha256: "seed-supplier-invoice-8897",
      storedPath: "seed://supplier-invoice-8897.xlsx",
      sourceType: "XLSX",
      extractor: "DETERMINISTIC",
      status: "COMMITTED",
      businessDate: "2026-06-07",
      committedAt: new Date(),
      committedById: staff.id,
      createdById: staff.id,
      createdByName: staff.name,
      rows: {
        create: [
          { rowIndex: 0, rawJson: JSON.stringify({ item: "Tonic Water", qty: 12, cost: 30 }), itemText: "Tonic Water", qty: 12, unitCost: 30, rowDate: "2026-06-07", matchedLocationItemId: tonic.id, matchMethod: "EXACT", confidence: 1, status: "COMMITTED" },
          { rowIndex: 1, rawJson: JSON.stringify({ item: "Cola", qty: 6, cost: 42 }), itemText: "Cola", qty: 6, unitCost: 42, rowDate: "2026-06-07", matchedLocationItemId: (await demoLocationItem(location.id, "Cola", 1)).id, matchMethod: "EXACT", confidence: 1, status: "COMMITTED" },
        ],
      },
    },
  });
}

async function seedKitchenCycle() {
  const location = await demoLocation("Prime Hospitality Group", "Kitchen");
  const staff = await demoActor("staff");
  const manager = await prisma.user.findUnique({ where: { username: "manager" } });
  if (!manager) throw new Error("Missing seed manager");
  const existing = await prisma.countSession.findFirst({ where: { locationId: location.id, countDate: "2026-06-01" } });
  if (existing) return;
  const chicken = await demoLocationItem(location.id, "Chicken Breast", 1);
  const steak = await demoLocationItem(location.id, "Ribeye Steak", 1);
  const fries = await demoLocationItem(location.id, "Potato Fries", 1);
  const oil = await demoLocationItem(location.id, "Cooking Oil", 1);
  const supplier = await prisma.supplier.findFirst({ where: { name: "Island Meat & Seafood" } });
  const encoder = { createdById: staff.id, createdByName: staff.name };
  const count = async (countDate: string, rows: Array<[typeof chicken, number]>) => {
    await prisma.countSession.create({
      data: {
        locationId: location.id,
        countDate,
        status: "COMMITTED",
        committedAt: new Date(),
        committedById: manager.id,
        ...encoder,
        lines: { create: rows.map(([item, qty]) => ({ locationItemId: item.id, countType: "FULL", qtyFull: qty, unitCost: item.cost, unitRetail: item.retail, ...encoder })) },
      },
    });
  };
  await count("2026-06-01", [[chicken, 18], [steak, 7], [fries, 20], [oil, 9]]);
  const purchase = await prisma.purchase.create({
    data: { locationId: location.id, supplierId: supplier?.id ?? null, refNo: "KITCH-2201", purchaseDate: "2026-06-03", status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...encoder },
  });
  for (const [item, qty] of [[chicken, 12], [steak, 4], [fries, 15]] as Array<[typeof chicken, number]>) {
    await prisma.purchaseLine.create({ data: { purchaseId: purchase.id, locationItemId: item.id, qty, unitCost: item.cost, lineTotal: qty * item.cost, ...encoder } });
  }
  const plate = await prisma.menuItem.create({ data: { locationId: location.id, name: "Grilled Chicken Plate" } });
  const version = await prisma.recipeVersion.create({
    data: {
      menuItemId: plate.id,
      versionNo: 1,
      srp: 420,
      costAtPublish: 0.22 * chicken.cost + 0.18 * fries.cost,
      publishedById: manager.id,
      lines: { create: [{ locationItemId: chicken.id, servingQty: 0.22, sortOrder: 0 }, { locationItemId: fries.id, servingQty: 0.18, sortOrder: 1 }] },
    },
  });
  await prisma.saleRecord.create({ data: { locationId: location.id, saleDate: "2026-06-04", kind: "SALE", menuItemId: plate.id, recipeVersionId: version.id, qty: 26, unitPrice: 420, ...encoder } });
  await prisma.saleRecord.create({ data: { locationId: location.id, saleDate: "2026-06-05", kind: "NON_REVENUE", locationItemId: chicken.id, qty: 1.2, unitPrice: 0, reason: "SPOILAGE", ...encoder } });
  await count("2026-06-08", [[chicken, 22.7], [steak, 10.5], [fries, 30.3], [oil, 8.2]]);
}

async function seedActivity() {
  const location = await demoLocation("Prime Hospitality Group", "Main Bar");
  const manager = await demoActor("manager");
  const rows: Array<[string, string, string]> = [
    ["auth.login", "User", "Manager signed in"],
    ["locationItem.priceChange", "LocationItem", "Updated Absolut Vodka 700 ml par level"],
    ["report.export", "Report", "Exported Full Audit 2026-06-01 to 2026-06-08"],
    ["settings.company", "Setting", "Updated report footer and company details"],
  ];
  for (const [action, entity, summary] of rows) {
    const exists = await prisma.activityLog.findFirst({ where: { locationId: location.id, action, summary } });
    if (!exists) {
      await prisma.activityLog.create({
        data: { userId: manager.id, userName: manager.name, clientId: location.clientId, locationId: location.id, action, entity, summary },
      });
    }
  }
}

async function main() {
  await seedUsers();
  await seedClients(); // includes demo subscriptions
  await seedUnits();
  await seedCategories();
  await seedSettings();
  await seedItems();
  // Prime Hospitality Group legitimately splits one operation into two locations —
  // "Main Bar" (BAR module -> Beverage) and "Kitchen" (KITCHEN module -> Food).
  // This is a real, supported pattern (see packaging-model-fix-plan.md §1.2), not
  // something to "merge" — do not collapse these back into a single location.
  await seedLocationCatalog("Prime Hospitality Group", "Main Bar", MAIN_BAR_PRICES);
  await seedLocationCatalog("Prime Hospitality Group", "Kitchen", KITCHEN_PRICES);
  // Casa Verde's subscription is KITCHEN-only (allowed productType = "Food"), so its
  // "Main" location must only ever be seeded from KITCHEN_PRICES. Seeding it from
  // MAIN_BAR_PRICES (vodka, whisky, wine, beer -> "Beverage") was the bug this plan
  // exists to fix: the real UI/validation in location-items.ts would reject this,
  // but the old seed script bypassed it. Do not reintroduce a bar/beverage price
  // list here.
  await seedLocationCatalog("Casa Verde Restaurant", "Main", KITCHEN_PRICES);
  await assertLocationCatalogWithinModules("Prime Hospitality Group", "Main Bar");
  await assertLocationCatalogWithinModules("Prime Hospitality Group", "Kitchen");
  await assertLocationCatalogWithinModules("Casa Verde Restaurant", "Main");
  await seedSuppliers();
  await seedGoldenCycle();
  await seedAliases();
  await seedOpenWork();
  await seedImportBatches();
  await seedTransferFixture();
  await seedKitchenCycle();
  await seedActivity();
  console.log(`Seed complete. Logins: admin / manager / staff / accountant / readonly — password ${PASSWORD}`);
  console.log("Demo subscriptions: Prime = Medium/{BAR,KITCHEN} (Main Bar=BAR, Kitchen=KITCHEN), Casa Verde = Basic/{KITCHEN}");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());