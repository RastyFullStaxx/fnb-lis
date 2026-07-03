import { prisma } from "../src/db";
import { hashPassword } from "../src/auth/password";

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
      update: { role: u.role, status: "ACTIVE" },
      create: { ...u, passwordHash, email: `${u.username}@fnb-lis.local` },
    });
  }
}

async function seedClients() {
  const prime = await upsertClientByName("Prime Hospitality Group");
  await upsertLocation(prime.id, "Main Bar");
  await upsertLocation(prime.id, "Kitchen");

  const casa = await upsertClientByName("Casa Verde Restaurant");
  await upsertLocation(casa.id, "Main");

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

async function upsertClientByName(name: string) {
  const existing = await prisma.client.findFirst({ where: { name } });
  return existing ?? prisma.client.create({ data: { name } });
}

async function upsertLocation(clientId: string, name: string) {
  const existing = await prisma.location.findFirst({ where: { clientId, name } });
  return existing ?? prisma.location.create({ data: { clientId, name } });
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
  // Density factors (ml per weight-unit on the oz scale) verified from legacy fnb.sql.
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
    { key: "productTypes", value: ["Beverage", "Food", "Supplies"] },
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

// ── Seed v2: demo items + location catalogs ──
// Tare weights are in oz to match the legacy oz-scale density factors (ml per oz).

interface SeedVariant {
  size: number;
  unit: string;
  contentTracked?: boolean;
  tareWeight?: number;
  densityFactor?: number;
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
  {
    name: "Grenadine Syrup",
    category: "Syrup",
    // Item-level density override (no category default for Syrup).
    variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 15.0, densityFactor: 25.0 }],
  },
  { name: "Chicken Breast", category: "Poultry", variants: [{ size: 1, unit: "kg" }] },
  { name: "Cooking Oil", category: "Dry Goods", variants: [{ size: 1, unit: "L" }] },
  // Universality proof: a Supplies item counted in packs.
  { name: "Table Napkins", category: "Consumables", variants: [{ size: 1, unit: "pack" }] },
];

// [item name, size, unit, cost, retail] per location.
const MAIN_BAR_PRICES: Array<[string, number, string, number, number]> = [
  ["Absolut Vodka", 700, "ml", 620, 1650],
  ["Absolut Vodka", 1000, "ml", 850, 2200],
  ["Jack Daniel's Old No. 7", 700, "ml", 950, 2400],
  ["Bacardi Superior", 750, "ml", 550, 1400],
  ["Bombay Sapphire", 750, "ml", 1100, 2600],
  ["Jose Cuervo Especial", 750, "ml", 890, 2200],
  ["San Miguel Pale Pilsen", 330, "ml", 45, 120],
  ["Tonic Water", 200, "ml", 30, 90],
  ["Grenadine Syrup", 750, "ml", 180, 0], // deliberately unpriced retail → exercises the red badge
  ["Table Napkins", 1, "pack", 85, 0],
];

const KITCHEN_PRICES: Array<[string, number, string, number, number]> = [
  ["Chicken Breast", 1, "kg", 180, 320],
  ["Cooking Oil", 1, "L", 95, 160],
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
        },
      });
    }
  }
}

async function seedLocationCatalog(clientName: string, locationName: string, prices: Array<[string, number, string, number, number]>) {
  const location = await prisma.location.findFirst({
    where: { name: locationName, client: { name: clientName } },
  });
  if (!location) return;
  for (const [itemName, size, unitName, cost, retail] of prices) {
    const variant = await prisma.itemVariant.findFirst({
      where: { size, item: { name: itemName }, unit: { name: unitName } },
    });
    if (!variant) continue;
    await prisma.locationItem.upsert({
      where: { locationId_itemVariantId: { locationId: location.id, itemVariantId: variant.id } },
      update: {},
      create: { locationId: location.id, itemVariantId: variant.id, cost, retail },
    });
  }
}

async function seedSuppliers() {
  const prime = await prisma.client.findFirst({ where: { name: "Prime Hospitality Group" } });
  if (!prime) return;
  for (const name of ["Metro Beverage Distribution", "FreshFoods Corp"]) {
    const exists = await prisma.supplier.findFirst({ where: { clientId: prime.id, name } });
    if (!exists) await prisma.supplier.create({ data: { clientId: prime.id, name } });
  }
}

// ── Seed v3: the GOLDEN CYCLE (2026-06-01 → 2026-06-08 at Main Bar) ──
// Expected report numbers are hand-computed in docs/phases/phase-3-audit-cycle.md.
// The Full Audit report MUST reproduce them exactly.

async function seedGoldenCycle() {
  const location = await prisma.location.findFirst({
    where: { name: "Main Bar", client: { name: "Prime Hospitality Group" } },
  });
  const staff = await prisma.user.findUnique({ where: { username: "staff" } });
  const manager = await prisma.user.findUnique({ where: { username: "manager" } });
  if (!location || !staff || !manager) return;

  // Idempotency: skip if the golden begin count already exists.
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

  // remaining = phpRound((scale − tare) × density) — oz scale, factors from categories.
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

  // Beginning count — 2026-06-01
  await countSession("2026-06-01", [
    { item: absolut, full: 12 },
    { item: absolut, scale: 28.7, tare: 16.9, density: 30.12 }, // → 355 ml
    { item: jd, full: 8 },
    { item: jd, scale: 25.0, tare: 17.2, density: 30.86 }, // → 241 ml
    { item: beer, full: 48 },
    { item: tonic, full: 24 },
  ]);

  // Purchase — 2026-06-03 (committed)
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

  // Sales / non-revenue / production
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

  // Forfeit (returned bottle) — 2026-06-06: content re-enters stock.
  await prisma.forfeit.create({
    data: {
      locationId: location.id, forfeitDate: "2026-06-06", locationItemId: absolut.id,
      scaleWeight: 25.4, scaleUnit: "oz", tareWeight: 16.9, densityFactor: 30.12,
      remainingContent: weigh(25.4, 16.9, 30.12), // → 256 ml
      note: "Customer left unfinished bottle (table 7)", ...encoder,
    },
  });

  // Menu: Vodka Tonic v1 = 45 ml Absolut + 1 × Tonic 200 ml bottle, SRP 250.
  // costAtPublish = (45/700)×620 + 1×30 = 69.857142857…
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

  // Menu sales (recipe version snapshotted): ×12 clean, ×2 at 10% off, 1 staff non-rev.
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

  // Ending count — 2026-06-08 (tonic reflects the 15 bottles consumed via menus)
  await countSession("2026-06-08", [
    { item: absolut, full: 14 },
    { item: absolut, scale: 22.6, tare: 16.9, density: 30.12 }, // → 172 ml
    { item: jd, full: 6 },
    { item: jd, scale: 21.3, tare: 17.2, density: 30.86 }, // → 127 ml
    { item: beer, full: 39 },
    { item: tonic, full: 8 },
  ]);

  console.log("Golden cycle seeded (2026-06-01 → 2026-06-08 at Main Bar).");
}

async function main() {
  await seedUsers();
  await seedClients();
  await seedUnits();
  await seedCategories();
  await seedSettings();
  await seedItems();
  await seedLocationCatalog("Prime Hospitality Group", "Main Bar", MAIN_BAR_PRICES);
  await seedLocationCatalog("Prime Hospitality Group", "Kitchen", KITCHEN_PRICES);
  await seedSuppliers();
  await seedGoldenCycle();
  console.log(`Seed complete. Logins: admin / manager / staff / accountant / readonly — password ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
