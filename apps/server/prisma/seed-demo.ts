/**
 * Stacked demo history — the data that makes every page look like a real,
 * months-old operation instead of a single hand-built fixture.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SACRED WINDOWS — do not seed Main Bar or Depot activity on or before
 * 2026-06-15. docs/golden-fixtures.md pins:
 *   fixture 1  Main Bar [2026-06-01, 2026-06-08)
 *   fixture 2  Main Bar → Depot [2026-06-08, 2026-06-15)
 *   fixture 3  Cost Analysis over fixture 1's window
 *   fixture 5  Top Sellers over fixture 1's window
 * Everything below starts at the 2026-06-15 boundary count and moves forward,
 * so those windows reconcile byte-identically after a reseed. Kitchen is free
 * after 2026-06-08; Casa Verde has no fixtures at all.
 *
 * Weighted-average cost is also safe: it values an item from counts at or
 * before the as-of date and purchases strictly before it, so activity added
 * after 06-15 cannot move a valuation dated 06-08.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Periods run 06-15 → 06-22 → 06-30 → 07-08 → 07-14 → 07-20, leaving
 * 07-20/07-21 as a live open period so the reports that default to
 * "last count → today" are not empty on arrival.
 */
import { prisma } from "../src/db";

// ── Deterministic jitter ──────────────────────────────────────────────────
// Seeded LCG rather than Math.random: a reseed must reproduce the same
// numbers, or every screenshot and hand-check in the docs goes stale.
let lcg = 20260721;
function rand() {
  lcg = (lcg * 1103515245 + 12345) % 2147483648;
  return lcg / 2147483648;
}
/** Integer in [min, max]. */
function randInt(min: number, max: number) {
  return min + Math.floor(rand() * (max - min + 1));
}

/** Checked index — the schedules here are hand-written, so an out-of-range
    read is an authoring bug that should stop the seed, not seed a null. */
function at<T>(arr: readonly T[], i: number): T {
  const value = arr[i];
  if (value === undefined) throw new Error(`seed-demo: index ${i} out of range (len ${arr.length})`);
  return value;
}
/** A random day inside the period, never its opening boundary. */
function someDay(days: readonly string[]) {
  return at(days, randInt(1, days.length - 1));
}

/** PHP-parity half-away-from-zero, matching the count/weigh path in core. */
function weighContent(scale: number, tare: number, density: number) {
  const scaled = Number(((scale - tare) * density).toPrecision(15));
  return scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
}
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Catalog definitions ───────────────────────────────────────────────────

type ItemDef = {
  name: string;
  size: number;
  /** Present only for items counted by weight. */
  tare?: number;
  density?: number;
  /** Counted in fractional units — kitchen stock weighed in kg/L. Discrete
      items (bottles, cans, packs) must close on a whole number instead. */
  decimal?: boolean;
};

const BAR_ITEMS = {
  absolut700: { name: "Absolut Vodka", size: 700, tare: 16.9, density: 30.12 },
  absolut1000: { name: "Absolut Vodka", size: 1000, tare: 19.4, density: 30.12 },
  jd700: { name: "Jack Daniel's Old No. 7", size: 700, tare: 17.2, density: 30.86 },
  bacardi750: { name: "Bacardi Superior", size: 750, tare: 16.5, density: 30.49 },
  bombay750: { name: "Bombay Sapphire", size: 750, tare: 21.2, density: 30.49 },
  cuervo750: { name: "Jose Cuervo Especial", size: 750, tare: 17.6, density: 30.67 },
  grenadine750: { name: "Grenadine Syrup", size: 750, tare: 15.0, density: 25.0 },
  // House Red Wine is contentTracked but sold by the bottle here — counting it
  // whole is a legitimate "no bottle open at close" state, and the Wine
  // category carries no default density to weigh against.
  wine750: { name: "House Red Wine", size: 750 },
  beer330: { name: "San Miguel Pale Pilsen", size: 330 },
  tonic200: { name: "Tonic Water", size: 200 },
  // Cola and juice pour into cocktails by the fraction of a litre, so an open
  // bottle is normal at close — they count in decimals, not whole bottles.
  cola1: { name: "Cola", size: 1, decimal: true },
  oj1: { name: "Orange Juice", size: 1, decimal: true },
} satisfies Record<string, ItemDef>;

const KITCHEN_ITEMS = {
  chicken: { name: "Chicken Breast", size: 1, decimal: true },
  steak: { name: "Ribeye Steak", size: 1, decimal: true },
  salmon: { name: "Salmon Fillet", size: 1, decimal: true },
  butter: { name: "Butter", size: 1, decimal: true },
  fries: { name: "Potato Fries", size: 1, decimal: true },
  oil: { name: "Cooking Oil", size: 1, decimal: true },
} satisfies Record<string, ItemDef>;

type BarKey = keyof typeof BAR_ITEMS;
type KitchenKey = keyof typeof KITCHEN_ITEMS;

/** Per-item behaviour: how fast it moves, how it restocks, how its cost drifts. */
type Profile = {
  /** Whole units sold directly per period, before jitter. */
  sold: number;
  /** Units delivered when a purchase lands. */
  buyQty: number;
  /** Deliver every N periods (1 = every period). */
  buyEvery: number;
  /** Unit cost per delivery, cycled — drift is what makes weighted-average
      diverge visibly from purchase price on the cost-basis toggle. */
  costs: number[];
};

const BAR_PROFILES: Record<BarKey, Profile> = {
  absolut700: { sold: 3, buyQty: 6, buyEvery: 1, costs: [615, 628, 640, 655, 649] },
  absolut1000: { sold: 2, buyQty: 4, buyEvery: 2, costs: [845, 862, 878] },
  jd700: { sold: 2, buyQty: 3, buyEvery: 1, costs: [948, 962, 975, 969, 981] },
  bacardi750: { sold: 2, buyQty: 6, buyEvery: 2, costs: [548, 556, 570] },
  bombay750: { sold: 1, buyQty: 4, buyEvery: 2, costs: [1095, 1120, 1108] },
  cuervo750: { sold: 1, buyQty: 3, buyEvery: 2, costs: [886, 899, 912] },
  grenadine750: { sold: 0, buyQty: 2, buyEvery: 3, costs: [178, 186] },
  wine750: { sold: 4, buyQty: 8, buyEvery: 1, costs: [418, 425, 432, 440, 436] },
  beer330: { sold: 30, buyQty: 48, buyEvery: 1, costs: [44, 45, 46, 45, 47] },
  tonic200: { sold: 10, buyQty: 36, buyEvery: 1, costs: [30, 31, 32, 31, 33] },
  cola1: { sold: 6, buyQty: 12, buyEvery: 1, costs: [42, 43, 44, 43, 45] },
  oj1: { sold: 5, buyQty: 10, buyEvery: 1, costs: [79, 82, 84, 86, 85] },
};

const KITCHEN_PROFILES: Record<KitchenKey, Profile> = {
  chicken: { sold: 0, buyQty: 14, buyEvery: 1, costs: [178, 182, 186, 190, 188] },
  steak: { sold: 2, buyQty: 6, buyEvery: 1, costs: [775, 792, 810, 803, 818] },
  salmon: { sold: 1, buyQty: 4, buyEvery: 1, costs: [615, 630, 648, 641, 655] },
  butter: { sold: 0, buyQty: 4, buyEvery: 2, costs: [318, 325, 334] },
  fries: { sold: 0, buyQty: 18, buyEvery: 1, costs: [109, 112, 115, 113, 117] },
  oil: { sold: 0, buyQty: 8, buyEvery: 2, costs: [94, 97, 101] },
};

/**
 * Deliberate variances, in units, keyed `period:item`. Everything unlisted
 * reconciles to zero — a demo where every row is off reads as a broken
 * system, and one where none is reads as a pointless report. These are the
 * rows the Variance Only filter and the verdict strip exist to surface.
 */
const VARIANCE_PLAN: Record<string, number> = {
  "1:beer330": -3, // short — the classic unrecorded pour
  "1:absolut700": -0.35,
  "2:tonic200": -2,
  "2:jd700": -0.5,
  "2:wine750": 1, // over — a bottle returned to stock without a record
  "3:beer330": -5,
  "3:cola1": -2,
  "3:bacardi750": -0.4,
  "4:beer330": -2,
  "4:absolut700": -0.6,
  "4:oj1": -1,
  "5:beer330": -4,
  "5:cuervo750": -0.3,
  "5:tonic200": -3,
};

const PERIODS = ["2026-06-15", "2026-06-22", "2026-06-30", "2026-07-08", "2026-07-14", "2026-07-20"];

/** Day offsets within a period, as YYYY-MM-DD, excluding the closing date. */
function daysBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── Lookup helpers ────────────────────────────────────────────────────────

async function locationOf(clientName: string, locationName: string) {
  const location = await prisma.location.findFirst({
    where: { name: locationName, client: { name: clientName } },
  });
  if (!location) throw new Error(`seed-demo: missing location ${clientName} / ${locationName}`);
  return location;
}

type Resolved = { id: string; cost: number; retail: number; def: ItemDef };

async function resolveItems<K extends string>(
  locationId: string,
  defs: Record<K, ItemDef>,
): Promise<Record<K, Resolved>> {
  const out = {} as Record<K, Resolved>;
  for (const [key, def] of Object.entries(defs) as Array<[K, ItemDef]>) {
    const row = await prisma.locationItem.findFirst({
      where: { locationId, itemVariant: { size: def.size, item: { name: def.name } } },
    });
    if (!row) throw new Error(`seed-demo: ${def.name} ${def.size} is not stocked at this location`);
    out[key] = { id: row.id, cost: row.cost, retail: row.retail, def };
  }
  return out;
}

type Actor = { createdById: string; createdByName: string };

async function actor(username: string): Promise<Actor> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`seed-demo: missing user ${username}`);
  return { createdById: user.id, createdByName: `${user.firstName} ${user.lastName}` };
}

// ── The ledger engine ─────────────────────────────────────────────────────

/**
 * Realises a target closing quantity as actual count lines.
 *
 * Content-tracked items close as N full units plus one open unit weighed on
 * the scale. The scale reading is the physical fact, so it is chosen first
 * (to one decimal, as a real scale reports) and the remaining content is
 * derived from it — deriving the reading from a desired content instead would
 * produce a session whose own numbers disagree once the app recomputes them.
 * The realised quantity is returned so the caller carries the true figure
 * forward rather than its own target.
 */
function realiseCount(target: number, item: Resolved) {
  const { tare, density, size } = item.def;
  const safe = Math.max(target, 0);
  if (tare === undefined || density === undefined) {
    const qty = item.def.decimal ? round2(safe) : Math.round(safe);
    return { qtyFull: qty, weigh: null, units: qty };
  }
  const qtyFull = Math.floor(safe);
  const frac = safe - qtyFull;
  if (frac < 0.001) return { qtyFull, weigh: null, units: qtyFull };
  // Two decimals, not one. Content is stored as whole millilitres, and a 0.1 oz
  // scale step is ~3 ml — too coarse to land on the millilitre the movement
  // implies, which left every weighed row carrying a spurious hairline
  // variance and made the Variance Only filter match almost everything. At
  // 0.01 oz the reading recomputes to the exact intended millilitre.
  const contentMl = Math.round(frac * size);
  const scale = round2(tare + contentMl / density);
  const content = weighContent(scale, tare, density);
  return {
    qtyFull,
    weigh: { scale, tare, density, content },
    units: qtyFull + content / size,
  };
}

/** Committed transfer movement for a location over the half-open [from, to). */
async function transferQty(locationId: string, from: string, to: string) {
  const outLines = await prisma.transferLine.findMany({
    where: {
      status: "ACTIVE",
      transfer: { fromLocationId: locationId, status: "COMMITTED", businessDate: { gte: from, lt: to } },
    },
    select: { locationItemId: true, qty: true },
  });
  const inLines = await prisma.transferReceiptLine.findMany({
    where: {
      status: "ACTIVE",
      receiptDate: { gte: from, lt: to },
      toLocationItem: { locationId },
    },
    select: { toLocationItemId: true, qtyReceived: true },
  });
  const out = new Map<string, number>();
  for (const l of outLines) out.set(l.locationItemId, (out.get(l.locationItemId) ?? 0) + l.qty);
  const into = new Map<string, number>();
  for (const l of inLines) into.set(l.toLocationItemId, (into.get(l.toLocationItemId) ?? 0) + l.qtyReceived);
  return { out, in: into };
}

type CountLineInput = { item: Resolved; target: number };

async function commitCount(
  locationId: string,
  countDate: string,
  lines: CountLineInput[],
  who: Actor,
  managerId: string,
  name?: string,
) {
  const session = await prisma.countSession.create({
    data: {
      locationId,
      countDate,
      name: name ?? null,
      status: "COMMITTED",
      committedAt: new Date(),
      committedById: managerId,
      ...who,
    },
  });
  const realised = new Map<string, number>();
  for (const { item, target } of lines) {
    const r = realiseCount(target, item);
    await prisma.countLine.create({
      data: {
        countSessionId: session.id,
        locationItemId: item.id,
        countType: "FULL",
        qtyFull: r.qtyFull,
        unitCost: item.cost,
        unitRetail: item.retail,
        ...who,
      },
    });
    if (r.weigh) {
      await prisma.countLine.create({
        data: {
          countSessionId: session.id,
          locationItemId: item.id,
          countType: "WEIGH",
          scaleWeight: r.weigh.scale,
          scaleUnit: "oz",
          tareWeight: r.weigh.tare,
          densityFactor: r.weigh.density,
          remainingContent: r.weigh.content,
          unitCost: item.cost,
          unitRetail: item.retail,
          ...who,
        },
      });
    }
    realised.set(item.id, r.units);
  }
  return realised;
}

const NR_BAR = ["SPOILAGE_SPILLAGE", "MARKETING_OTH", "SPOILAGE_SPILLAGE", "STAFF_USE"];
const NR_KITCHEN = ["TRIMMING", "SPOILAGE_SPILLAGE", "TRIMMING", "MARKETING_OTH"];

/**
 * Runs one location through its periods, writing purchases, sales,
 * non-revenue, production, forfeits and a closing count for each.
 *
 * Consumption is decided first, then the closing count is set to
 * `begin + stockIn − consumed + plannedVariance`. Because
 * `variance = expected − usage` and `usage = begin + stockIn − end`, that
 * plan value IS the variance the report will show — which is the only way to
 * author a demo whose variances are intentional rather than emergent.
 */
async function runLedger<K extends string>(opts: {
  locationId: string;
  items: Record<K, Resolved>;
  profiles: Record<K, Profile>;
  opening: Partial<Record<K, number>>;
  supplierIds: string[];
  refPrefix: string;
  who: Actor;
  managerId: string;
  nrReasons: string[];
  /** Recipe consumption in *units* per period, produced by the menu-sale pass. */
  recipeUnits: Array<Partial<Record<K, number>>>;
  variancePlan: Record<string, number>;
  forfeitKeys: K[];
}) {
  const keys = Object.keys(opts.items) as K[];
  const stock = new Map<K, number>();
  for (const k of keys) stock.set(k, opts.opening[k] ?? 0);

  for (let p = 1; p < PERIODS.length; p++) {
    const from = at(PERIODS, p - 1);
    const to = at(PERIODS, p);
    const days = daysBetween(from, to);
    const lines: CountLineInput[] = [];

    // Transfers are written by a separate pass, but they move real stock, so
    // the closing count has to reflect them or every transferred unit reads as
    // a variance. Read what actually landed in this window rather than
    // restating it here, so the two passes cannot drift apart.
    const { out: transferOut, in: transferIn } = await transferQty(opts.locationId, from, to);

    // One purchase document per supplier that has deliveries this period —
    // grouping by supplier is what gives the Purchase report's By-Supplier
    // rollup something to roll up.
    const bySupplier = new Map<string, Array<{ item: Resolved; qty: number; unitCost: number }>>();
    const stockIn = new Map<K, number>();

    for (let i = 0; i < keys.length; i++) {
      const key = at(keys, i);
      const item = opts.items[key];
      const profile = opts.profiles[key];
      const begin = stock.get(key) ?? 0;

      // ── Stock in ──
      // Offset by one so EVERY item takes a delivery in period 1 — items whose
      // cadence first fired later would spend that period being consumed by
      // recipes off a shelf that was never stocked, inventing a variance.
      let received = 0;
      if ((p - 1) % profile.buyEvery === 0 && profile.buyQty > 0) {
        const qty = profile.buyQty + (profile.buyQty >= 10 ? randInt(-2, 4) : 0);
        const unitCost = at(profile.costs, (p - 1) % profile.costs.length);
        const supplierId = at(opts.supplierIds, i % opts.supplierIds.length);
        const bucket = bySupplier.get(supplierId) ?? [];
        bucket.push({ item, qty, unitCost });
        bySupplier.set(supplierId, bucket);
        received = qty;
      }
      stockIn.set(key, received);

      // ── Consumption, clamped so the shelf never goes negative ──
      const available = begin + received;
      const recipe = opts.recipeUnits[p - 1]?.[key] ?? 0;
      let sold = profile.sold > 0 ? profile.sold + randInt(-1, 2) : 0;
      sold = Math.max(0, Math.min(sold, Math.floor(Math.max(available - recipe - 1, 0) * 0.7)));

      // Non-revenue lands on roughly every other item, cycling the three
      // client buckets plus one legacy reason that belongs to none of them.
      let nrUnits = 0;
      let nr: { qty: number; reason: string; contentMl?: number } | null = null;
      if (available > 2 && rand() < 0.45) {
        const reason = at(opts.nrReasons, (p + i) % opts.nrReasons.length);
        if (item.def.tare !== undefined) {
          const contentMl = at([30, 45, 60], randInt(0, 2));
          nr = { qty: 1, reason, contentMl };
          nrUnits = contentMl / item.def.size;
        } else {
          const qty = Math.min(randInt(1, 3), Math.floor(available * 0.1) + 1);
          nr = { qty, reason };
          nrUnits = qty;
        }
      }

      // Production: bar batches (syrup, juice) and kitchen prep only.
      let production = 0;
      if ((key as string) === "grenadine750" || (key as string) === "oj1" || (key as string) === "oil") {
        if (available > 3 && rand() < 0.5) production = randInt(1, 2);
      }

      // Forfeits add content back into the pool before the closing count.
      let forfeitUnits = 0;
      let forfeit: { scale: number; tare: number; density: number; content: number } | null = null;
      if (opts.forfeitKeys.includes(key) && rand() < 0.4 && item.def.tare && item.def.density) {
        const scale = round1(item.def.tare + randInt(4, 9));
        const content = weighContent(scale, item.def.tare, item.def.density);
        forfeit = { scale, tare: item.def.tare, density: item.def.density, content };
        forfeitUnits = content / item.def.size;
      }

      // ── Write the movement records ──
      if (sold > 0) {
        await prisma.saleRecord.create({
          data: {
            locationId: opts.locationId,
            saleDate: someDay(days),
            kind: "SALE",
            locationItemId: item.id,
            qty: sold,
            unitPrice: item.retail,
            discountPct: rand() < 0.2 ? at([5, 10, 15], randInt(0, 2)) : 0,
            ...opts.who,
          },
        });
      }
      if (nr) {
        await prisma.saleRecord.create({
          data: {
            locationId: opts.locationId,
            saleDate: someDay(days),
            kind: "NON_REVENUE",
            locationItemId: item.id,
            qty: nr.qty,
            unitPrice: 0,
            contentOverride: nr.contentMl ?? null,
            reason: nr.reason,
            ...opts.who,
          },
        });
      }
      if (production > 0) {
        await prisma.saleRecord.create({
          data: {
            locationId: opts.locationId,
            saleDate: someDay(days),
            kind: "PRODUCTION",
            locationItemId: item.id,
            qty: production,
            unitPrice: 0,
            ...opts.who,
          },
        });
      }
      if (forfeit) {
        await prisma.forfeit.create({
          data: {
            locationId: opts.locationId,
            forfeitDate: someDay(days),
            locationItemId: item.id,
            scaleWeight: forfeit.scale,
            scaleUnit: "oz",
            tareWeight: forfeit.tare,
            densityFactor: forfeit.density,
            remainingContent: forfeit.content,
            note: "Returned unfinished bottle",
            ...opts.who,
          },
        });
      }

      const consumed = sold + recipe + nrUnits + production;
      const moved = (transferIn.get(item.id) ?? 0) - (transferOut.get(item.id) ?? 0);
      const planned = opts.variancePlan[`${p}:${key}`] ?? 0;
      // Whole-unit items can only close on a whole number, so a fractional
      // plan value would silently become something else.
      const discrete = item.def.tare === undefined && !item.def.decimal;
      const variance = discrete ? Math.round(planned) : planned;
      const target = begin + received + forfeitUnits + moved - consumed + variance;
      // A negative shelf means the profile lets recipes outrun deliveries.
      // Clamping it silently would surface later as a phantom positive
      // variance on an item nobody planned one for, so fail the seed instead.
      if (target < 0) {
        throw new Error(
          `seed-demo: ${item.def.name} ${item.def.size} goes negative in period ${p} ` +
            `(begin ${begin.toFixed(2)} + in ${received} + moved ${moved} − used ${consumed.toFixed(2)} = ${target.toFixed(2)}). ` +
            `Raise buyQty or lower the profile's sales/recipe demand.`,
        );
      }
      lines.push({ item, target });
    }

    // ── Purchase documents ──
    let docNo = 0;
    for (const [supplierId, bucket] of bySupplier) {
      docNo++;
      const purchase = await prisma.purchase.create({
        data: {
          locationId: opts.locationId,
          purchaseDate: at(days, Math.min(1, days.length - 1)),
          supplierId,
          refNo: `${opts.refPrefix}-${to.replace(/-/g, "").slice(4)}-${docNo}`,
          status: "COMMITTED",
          committedAt: new Date(),
          committedById: opts.managerId,
          ...opts.who,
        },
      });
      for (const line of bucket) {
        await prisma.purchaseLine.create({
          data: {
            purchaseId: purchase.id,
            locationItemId: line.item.id,
            qty: line.qty,
            unitCost: line.unitCost,
            lineTotal: round2(line.qty * line.unitCost),
            ...opts.who,
          },
        });
      }
    }

    // ── Close the period ──
    const realised = await commitCount(opts.locationId, to, lines, opts.who, opts.managerId);
    for (const key of keys) stock.set(key, realised.get(opts.items[key].id) ?? 0);
  }

  return stock;
}

// ── Recipes ───────────────────────────────────────────────────────────────

type RecipeSpec = {
  menu: string;
  srp: number;
  lines: Array<{ key: string; servingQty: number }>;
  /** Units sold per period — drives both the sale records and recipe usage. */
  perPeriod: number[];
};

async function seedRecipes<K extends string>(opts: {
  locationId: string;
  items: Record<K, Resolved>;
  specs: RecipeSpec[];
  who: Actor;
  managerId: string;
}) {
  /** Recipe consumption per period, in units, accumulated across all menus. */
  const usage: Array<Partial<Record<K, number>>> = PERIODS.slice(1).map(() => ({}));

  for (const spec of opts.specs) {
    let menu = await prisma.menuItem.findFirst({ where: { locationId: opts.locationId, name: spec.menu } });
    if (!menu) menu = await prisma.menuItem.create({ data: { locationId: opts.locationId, name: spec.menu } });

    const last = await prisma.recipeVersion.findFirst({
      where: { menuItemId: menu.id },
      orderBy: { versionNo: "desc" },
    });
    const versionNo = (last?.versionNo ?? 0) + 1;
    const costAtPublish = spec.lines.reduce((sum, l) => {
      const item = opts.items[l.key as K];
      const def = item.def;
      // contentTracked ingredients are specified in content units (ml), so
      // their cost share is the fraction of a whole unit the serving uses.
      const share = def.tare !== undefined ? l.servingQty / def.size : l.servingQty;
      return sum + share * item.cost;
    }, 0);

    const version = await prisma.recipeVersion.create({
      data: {
        menuItemId: menu.id,
        versionNo,
        srp: spec.srp,
        costAtPublish: round2(costAtPublish),
        publishedById: opts.managerId,
        note: versionNo > 1 ? "Repriced for the July menu refresh" : null,
        lines: {
          create: spec.lines.map((l, i) => ({
            locationItemId: opts.items[l.key as K].id,
            servingQty: l.servingQty,
            sortOrder: i,
          })),
        },
      },
    });

    for (let p = 1; p < PERIODS.length; p++) {
      const qty = spec.perPeriod[p - 1] ?? 0;
      if (qty <= 0) continue;
      const days = daysBetween(at(PERIODS, p - 1), at(PERIODS, p));
      await prisma.saleRecord.create({
        data: {
          locationId: opts.locationId,
          saleDate: at(days, Math.min(2, days.length - 1)),
          kind: "SALE",
          menuItemId: menu.id,
          recipeVersionId: version.id,
          qty,
          unitPrice: spec.srp,
          discountPct: p % 3 === 0 ? 10 : 0,
          ...opts.who,
        },
      });
      // A couple of comped rounds so the Non-Revenue report shows menu items
      // alongside raw stock, the way an on-the-house round actually books.
      if (p % 2 === 0) {
        await prisma.saleRecord.create({
          data: {
            locationId: opts.locationId,
            saleDate: at(days, Math.min(3, days.length - 1)),
            kind: "NON_REVENUE",
            menuItemId: menu.id,
            recipeVersionId: version.id,
            qty: 1,
            unitPrice: 0,
            reason: "MARKETING_OTH",
            ...opts.who,
          },
        });
      }
      const comped = p % 2 === 0 ? 1 : 0;
      for (const l of spec.lines) {
        const key = l.key as K;
        const def = opts.items[key].def;
        const perUnit = def.tare !== undefined ? l.servingQty / def.size : l.servingQty;
        const bucket = at(usage, p - 1);
        bucket[key] = (bucket[key] ?? 0) + perUnit * (qty + comped);
      }
    }
  }

  return usage;
}

// ── Location runs ─────────────────────────────────────────────────────────

const BAR_RECIPES: RecipeSpec[] = [
  // Vodka Tonic already exists at v1 from the golden cycle — this publishes v2
  // so the recipe page has a real version history to show.
  { menu: "Vodka Tonic", srp: 280, lines: [{ key: "absolut700", servingQty: 45 }, { key: "tonic200", servingQty: 1 }], perPeriod: [14, 18, 16, 12, 15] },
  { menu: "Cuba Libre", srp: 260, lines: [{ key: "bacardi750", servingQty: 45 }, { key: "cola1", servingQty: 0.25 }], perPeriod: [10, 12, 9, 11, 13] },
  { menu: "Gin & Tonic", srp: 300, lines: [{ key: "bombay750", servingQty: 45 }, { key: "tonic200", servingQty: 1 }], perPeriod: [8, 7, 10, 9, 8] },
  { menu: "Tequila Sunrise", srp: 320, lines: [{ key: "cuervo750", servingQty: 45 }, { key: "oj1", servingQty: 0.15 }, { key: "grenadine750", servingQty: 15 }], perPeriod: [6, 8, 7, 5, 9] },
  { menu: "Whiskey Sour", srp: 340, lines: [{ key: "jd700", servingQty: 50 }, { key: "grenadine750", servingQty: 10 }], perPeriod: [7, 6, 8, 7, 6] },
];

const KITCHEN_RECIPES: RecipeSpec[] = [
  { menu: "Grilled Chicken Plate", srp: 440, lines: [{ key: "chicken", servingQty: 0.22 }, { key: "fries", servingQty: 0.18 }], perPeriod: [28, 32, 26, 30, 34] },
  { menu: "Ribeye Steak Plate", srp: 980, lines: [{ key: "steak", servingQty: 0.3 }, { key: "fries", servingQty: 0.2 }, { key: "butter", servingQty: 0.02 }], perPeriod: [9, 11, 8, 10, 12] },
  { menu: "Pan-Seared Salmon", srp: 720, lines: [{ key: "salmon", servingQty: 0.26 }, { key: "butter", servingQty: 0.03 }], perPeriod: [7, 6, 9, 8, 7] },
];

const CASA_RECIPES: RecipeSpec[] = [
  { menu: "Chicken Adobo Rice Bowl", srp: 320, lines: [{ key: "chicken", servingQty: 0.24 }, { key: "oil", servingQty: 0.02 }], perPeriod: [34, 38, 31, 36, 40] },
  { menu: "Grilled Salmon Verde", srp: 690, lines: [{ key: "salmon", servingQty: 0.25 }, { key: "butter", servingQty: 0.03 }], perPeriod: [8, 7, 10, 9, 11] },
  { menu: "Truffle Fries", srp: 240, lines: [{ key: "fries", servingQty: 0.25 }, { key: "oil", servingQty: 0.03 }], perPeriod: [22, 26, 20, 24, 28] },
];

async function seedMainBar() {
  const location = await locationOf("Prime Hospitality Group", "Main Bar");
  if (await prisma.countSession.findFirst({ where: { locationId: location.id, countDate: "2026-06-22" } })) return false;

  const items = await resolveItems(location.id, BAR_ITEMS);
  const who = await actor("staff");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const suppliers = await prisma.supplier.findMany({
    where: { client: { name: "Prime Hospitality Group" }, isActive: true, name: { in: ["Metro Beverage Distribution", "Bar Essentials Supply", "Sunrise Dairy & Produce"] } },
  });

  const recipeUsage = await seedRecipes({ locationId: location.id, items, specs: BAR_RECIPES, who, managerId: manager.id });

  // Opening stock is whatever the 2026-06-15 boundary count left on the shelf.
  // Items the bar did not carry until now open at zero and are introduced by
  // their first delivery, which is exactly how a catalog expansion books.
  const opening = await openingFromCount(location.id, "2026-06-15", items);

  await runLedger({
    locationId: location.id,
    items,
    profiles: BAR_PROFILES,
    opening,
    supplierIds: suppliers.map((s) => s.id),
    refPrefix: "BAR",
    who,
    managerId: manager.id,
    nrReasons: NR_BAR,
    recipeUnits: recipeUsage,
    variancePlan: VARIANCE_PLAN,
    forfeitKeys: ["absolut700", "jd700", "bombay750"],
  });
  return true;
}

/** Closing quantities from a committed count, as opening stock for the next run. */
async function openingFromCount<K extends string>(
  locationId: string,
  countDate: string,
  items: Record<K, Resolved>,
) {
  const session = await prisma.countSession.findFirst({
    where: { locationId, countDate, status: "COMMITTED" },
    include: { lines: true },
  });
  const opening = {} as Partial<Record<K, number>>;
  if (!session) return opening;
  for (const [key, item] of Object.entries(items) as Array<[K, Resolved]>) {
    const lines = session.lines.filter((l) => l.locationItemId === item.id);
    if (lines.length === 0) continue;
    const full = lines.filter((l) => l.countType === "FULL").reduce((n, l) => n + (l.qtyFull ?? 0), 0);
    const content = lines.filter((l) => l.countType === "WEIGH").reduce((n, l) => n + l.remainingContent, 0);
    opening[key] = full + (item.def.tare !== undefined ? content / item.def.size : 0);
  }
  return opening;
}

async function seedKitchen() {
  const location = await locationOf("Prime Hospitality Group", "Kitchen");
  if (await prisma.countSession.findFirst({ where: { locationId: location.id, countDate: "2026-06-22" } })) return false;

  const items = await resolveItems(location.id, KITCHEN_ITEMS);
  const who = await actor("staff");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const suppliers = await prisma.supplier.findMany({
    where: { client: { name: "Prime Hospitality Group" }, isActive: true, name: { in: ["FreshFoods Corp", "Island Meat & Seafood", "Sunrise Dairy & Produce"] } },
  });
  const recipeUsage = await seedRecipes({ locationId: location.id, items, specs: KITCHEN_RECIPES, who, managerId: manager.id });

  // The kitchen's last committed count is 2026-06-08; bridge it to the
  // 06-15 period boundary with a count so its history lines up with the bar's.
  const bridge = await openingFromCount(location.id, "2026-06-08", items);
  const bridgeLines = (Object.keys(items) as KitchenKey[]).map((k) => ({ item: items[k], target: bridge[k] ?? 0 }));
  const realised = await commitCount(location.id, "2026-06-15", bridgeLines, who, manager.id, "Mid-June boundary count");
  const opening = {} as Partial<Record<KitchenKey, number>>;
  for (const k of Object.keys(items) as KitchenKey[]) opening[k] = realised.get(items[k].id) ?? 0;

  await runLedger({
    locationId: location.id,
    items,
    profiles: KITCHEN_PROFILES,
    opening,
    supplierIds: suppliers.map((s) => s.id),
    refPrefix: "KITCH",
    who,
    managerId: manager.id,
    nrReasons: NR_KITCHEN,
    recipeUnits: recipeUsage,
    variancePlan: {
      "1:chicken": -0.8, "2:fries": -1.5, "2:steak": -0.4,
      "3:chicken": -1.2, "3:oil": -0.5, "4:salmon": -0.3,
      "4:fries": -2, "5:chicken": -0.9, "5:butter": -0.4,
    },
    forfeitKeys: [],
  });
  return true;
}

/**
 * Casa Verde had no committed counts at all, which is why every chart-driven
 * surface rendered empty for that client — the revamp was applied, there was
 * simply nothing to draw. It gets the same six-boundary history as Prime.
 */
async function seedCasaVerde() {
  const location = await locationOf("Casa Verde Restaurant", "Main");
  if (await prisma.countSession.findFirst({ where: { locationId: location.id, countDate: "2026-06-22" } })) return false;

  const items = await resolveItems(location.id, KITCHEN_ITEMS);
  const who = await actor("manager");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const suppliers = await prisma.supplier.findMany({
    where: { client: { name: "Casa Verde Restaurant" }, isActive: true },
  });
  const recipeUsage = await seedRecipes({ locationId: location.id, items, specs: CASA_RECIPES, who, managerId: manager.id });

  const opening: Partial<Record<KitchenKey, number>> = {
    chicken: 24, steak: 9, salmon: 6, butter: 5, fries: 26, oil: 11,
  };
  const openingLines = (Object.keys(items) as KitchenKey[]).map((k) => ({ item: items[k], target: opening[k] ?? 0 }));
  await commitCount(location.id, "2026-06-15", openingLines, who, manager.id, "Opening inventory");

  await runLedger({
    locationId: location.id,
    items,
    profiles: KITCHEN_PROFILES,
    opening,
    supplierIds: suppliers.map((s) => s.id),
    refPrefix: "CV",
    who,
    managerId: manager.id,
    nrReasons: NR_KITCHEN,
    recipeUnits: recipeUsage,
    variancePlan: {
      "1:fries": -1.5, "2:chicken": -1.1, "2:salmon": -0.4,
      "3:steak": -0.5, "3:fries": -2, "4:chicken": -0.7,
      "5:oil": -0.6, "5:butter": -0.3,
    },
    forfeitKeys: [],
  });
  return true;
}

/**
 * Two more Main Bar → Depot transfers so the Transfer In/Out reports show a
 * pattern rather than the single fixture row: one received in full, one short
 * again. Dated well clear of fixture 2's window.
 */
async function seedMoreTransfers() {
  const mainBar = await locationOf("Prime Hospitality Group", "Main Bar");
  const depot = await locationOf("Prime Hospitality Group", "Depot");
  if (await prisma.transfer.findFirst({ where: { fromLocationId: mainBar.id, businessDate: "2026-07-02" } })) return false;

  const who = await actor("staff");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const barBeer = await prisma.locationItem.findFirstOrThrow({
    where: { locationId: mainBar.id, itemVariant: { size: 330, item: { name: "San Miguel Pale Pilsen" } } },
  });
  const depotBeer = await prisma.locationItem.findFirstOrThrow({
    where: { locationId: depot.id, itemVariant: { size: 330, item: { name: "San Miguel Pale Pilsen" } } },
  });

  for (const [date, qty, received, note] of [
    ["2026-07-02", 12, 12, null],
    ["2026-07-16", 18, 15, "3 bottles short on arrival"],
  ] as Array<[string, number, number, string | null]>) {
    const transfer = await prisma.transfer.create({
      data: {
        fromLocationId: mainBar.id, toLocationId: depot.id, businessDate: date,
        status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...who,
      },
    });
    const line = await prisma.transferLine.create({
      data: { transferId: transfer.id, locationItemId: barBeer.id, qty, unitCost: barBeer.cost, lineTotal: qty * barBeer.cost, ...who },
    });
    await prisma.transferReceiptLine.create({
      data: { transferLineId: line.id, toLocationItemId: depotBeer.id, qtyReceived: received, receiptDate: date, note, ...who },
    });
  }
  return true;
}

/**
 * The Depot's own books. It receives the two new transfers, sells a little,
 * and closes on the same 07-08 / 07-20 boundaries — without these counts the
 * stockroom would show stock arriving and never being reconciled.
 */
async function seedDepot() {
  const depot = await locationOf("Prime Hospitality Group", "Depot");
  if (await prisma.countSession.findFirst({ where: { locationId: depot.id, countDate: "2026-07-20" } })) return false;

  const who = await actor("staff");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const beer = await prisma.locationItem.findFirstOrThrow({
    where: { locationId: depot.id, itemVariant: { size: 330, item: { name: "San Miguel Pale Pilsen" } } },
  });
  const item: Resolved = { id: beer.id, cost: beer.cost, retail: beer.retail, def: BAR_ITEMS.beer330 };

  // Opening 7 (the 2026-06-15 fixture close), +12 received 07-02, 4 sold.
  await prisma.saleRecord.create({
    data: { locationId: depot.id, saleDate: "2026-07-05", kind: "SALE", locationItemId: beer.id, qty: 4, unitPrice: beer.retail, ...who },
  });
  await commitCount(depot.id, "2026-07-08", [{ item, target: 15 }], who, manager.id);

  // +15 received 07-16, 6 sold, 1 spilled.
  await prisma.saleRecord.create({
    data: { locationId: depot.id, saleDate: "2026-07-18", kind: "SALE", locationItemId: beer.id, qty: 6, unitPrice: beer.retail, ...who },
  });
  await prisma.saleRecord.create({
    data: { locationId: depot.id, saleDate: "2026-07-18", kind: "NON_REVENUE", locationItemId: beer.id, qty: 1, unitPrice: 0, reason: "SPOILAGE_SPILLAGE", ...who },
  });
  await commitCount(depot.id, "2026-07-20", [{ item, target: 23 }], who, manager.id);
  return true;
}

/** A menu item and its current published recipe version, for open-period sales. */
async function latestMenuVersion(locationId: string, name: string) {
  const menu = await prisma.menuItem.findFirst({ where: { locationId, name } });
  if (!menu) return null;
  const version = await prisma.recipeVersion.findFirst({
    where: { menuItemId: menu.id },
    orderBy: { versionNo: "desc" },
  });
  return version ? { menuId: menu.id, versionId: version.id, srp: version.srp } : null;
}

/**
 * The live open period for the Main Bar: entries recorded after the last
 * committed count so every report that defaults to "last count → today" opens
 * on data, not an empty state — and so does every TAB of every report. It
 * deliberately carries one of each record kind:
 *   direct sales · discounted sale · recipe (menu) sales · PRODUCTION ·
 *   non-revenue across all three buckets · a purchase · a forfeit · a transfer.
 * No closing count follows, so none of this touches a committed audit window;
 * it is stock in flight, exactly what the open period represents.
 */
async function seedOpenPeriod() {
  const location = await locationOf("Prime Hospitality Group", "Main Bar");
  const depot = await locationOf("Prime Hospitality Group", "Depot");
  if (await prisma.saleRecord.findFirst({ where: { locationId: location.id, saleDate: "2026-07-21" } })) return false;

  const items = await resolveItems(location.id, BAR_ITEMS);
  const who = await actor("staff");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { name: "Metro Beverage Distribution" } });

  // ── Purchases from TWO suppliers (Purchase report + its By-Supplier chart,
  //    which needs ≥2 suppliers to draw) ──
  const barEssentials = await prisma.supplier.findFirst({
    where: { name: "Bar Essentials Supply", client: { name: "Prime Hospitality Group" } },
  });
  const purchase = await prisma.purchase.create({
    data: {
      locationId: location.id, purchaseDate: "2026-07-20", supplierId: supplier.id,
      refNo: "BAR-0721-1", status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...who,
    },
  });
  for (const [key, qty, unitCost] of [["beer330", 48, 47], ["tonic200", 24, 33], ["absolut700", 6, 649]] as Array<[BarKey, number, number]>) {
    await prisma.purchaseLine.create({
      data: { purchaseId: purchase.id, locationItemId: items[key].id, qty, unitCost, lineTotal: round2(qty * unitCost), ...who },
    });
  }
  const purchase2 = await prisma.purchase.create({
    data: {
      locationId: location.id, purchaseDate: "2026-07-21", supplierId: barEssentials?.id ?? null,
      refNo: "BAR-0721-2", status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...who,
    },
  });
  for (const [key, qty, unitCost] of [["cola1", 12, 45], ["oj1", 10, 85]] as Array<[BarKey, number, number]>) {
    await prisma.purchaseLine.create({
      data: { purchaseId: purchase2.id, locationItemId: items[key].id, qty, unitCost, lineTotal: round2(qty * unitCost), ...who },
    });
  }

  // ── Direct item sales, one discounted (Sales report + Discounted view) ──
  for (const [key, date, qty, disc] of [
    ["beer330", "2026-07-20", 22, 0],
    ["beer330", "2026-07-21", 18, 0],
    ["wine750", "2026-07-21", 3, 0],
    ["cola1", "2026-07-20", 5, 0],
    ["absolut700", "2026-07-20", 2, 10], // the discounted line
  ] as Array<[BarKey, string, number, number]>) {
    await prisma.saleRecord.create({
      data: {
        locationId: location.id, saleDate: date, kind: "SALE", locationItemId: items[key].id,
        qty, unitPrice: items[key].retail, discountPct: disc, ...who,
      },
    });
  }

  // ── Recipe (menu) sales — Top Sellers menus/ingredients + Sales-by-Item shot ──
  for (const [name, date, qty, disc] of [
    ["Vodka Tonic", "2026-07-20", 6, 0],
    ["Cuba Libre", "2026-07-21", 4, 0],
    ["Gin & Tonic", "2026-07-21", 3, 15], // discounted menu sale
  ] as Array<[string, string, number, number]>) {
    const mv = await latestMenuVersion(location.id, name);
    if (!mv) continue;
    await prisma.saleRecord.create({
      data: {
        locationId: location.id, saleDate: date, kind: "SALE", menuItemId: mv.menuId,
        recipeVersionId: mv.versionId, qty, unitPrice: mv.srp, discountPct: disc, ...who,
      },
    });
  }

  // ── Production (Sales → Production view): a batch of grenadine + fresh OJ ──
  for (const [key, date, qty] of [["grenadine750", "2026-07-20", 2], ["oj1", "2026-07-21", 1]] as Array<[BarKey, string, number]>) {
    await prisma.saleRecord.create({
      data: { locationId: location.id, saleDate: date, kind: "PRODUCTION", locationItemId: items[key].id, qty, unitPrice: 0, ...who },
    });
  }

  // ── Non-revenue across ALL THREE buckets (Non-Revenue report tabs) ──
  await prisma.saleRecord.create({
    data: { locationId: location.id, saleDate: "2026-07-21", kind: "NON_REVENUE", locationItemId: items.beer330.id, qty: 2, unitPrice: 0, reason: "SPOILAGE_SPILLAGE", ...who },
  });
  await prisma.saleRecord.create({
    data: { locationId: location.id, saleDate: "2026-07-20", kind: "NON_REVENUE", locationItemId: items.tonic200.id, qty: 1, unitPrice: 0, reason: "TRIMMING", ...who },
  });
  const vt = await latestMenuVersion(location.id, "Vodka Tonic");
  if (vt) {
    await prisma.saleRecord.create({
      data: { locationId: location.id, saleDate: "2026-07-21", kind: "NON_REVENUE", menuItemId: vt.menuId, recipeVersionId: vt.versionId, qty: 1, unitPrice: 0, reason: "MARKETING_OTH", ...who },
    });
  }

  // ── Forfeits (Forfeited Bottles report + its by-item chart, ≥2 items to
  //    draw): two half-finished bottles returned ──
  for (const [key, date, scale, tare, density, note] of [
    ["absolut700", "2026-07-21", 22.0, 16.9, 30.12, "Customer left unfinished bottle (table 4)"],
    ["jd700", "2026-07-20", 24.0, 17.2, 30.86, "Returned after last call (table 9)"],
  ] as Array<[BarKey, string, number, number, number, string]>) {
    await prisma.forfeit.create({
      data: {
        locationId: location.id, forfeitDate: date, locationItemId: items[key].id,
        scaleWeight: scale, scaleUnit: "oz", tareWeight: tare, densityFactor: density,
        remainingContent: weighContent(scale, tare, density),
        note, ...who,
      },
    });
  }

  // ── Transfer Main Bar → Depot (Transfers report, both Out and In tabs) ──
  const barBeer = items.beer330;
  const depotBeer = await prisma.locationItem.findFirstOrThrow({
    where: { locationId: depot.id, itemVariant: { size: 330, item: { name: "San Miguel Pale Pilsen" } } },
  });
  const transfer = await prisma.transfer.create({
    data: {
      fromLocationId: location.id, toLocationId: depot.id, businessDate: "2026-07-21",
      status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...who,
    },
  });
  const line = await prisma.transferLine.create({
    data: { transferId: transfer.id, locationItemId: barBeer.id, qty: 10, unitCost: barBeer.cost, lineTotal: round2(10 * barBeer.cost), ...who },
  });
  await prisma.transferReceiptLine.create({
    data: { transferLineId: line.id, toLocationItemId: depotBeer.id, qtyReceived: 10, receiptDate: "2026-07-21", note: null, ...who },
  });
  return true;
}

/**
 * A light open period for the food locations (Kitchen, Casa Verde) so their
 * range-based reports land on data too. Forfeits and Transfers stay empty for
 * these on purpose — a kitchen books no bottle forfeits, and Casa Verde is a
 * single-location client with nowhere to transfer to; those empties are the
 * real state, not a seed gap.
 */
async function seedFoodOpenPeriod(clientName: string, locationName: string, refPrefix: string, supplierName: string, menuNames: string[]) {
  const location = await locationOf(clientName, locationName);
  if (await prisma.saleRecord.findFirst({ where: { locationId: location.id, saleDate: "2026-07-21" } })) return false;

  const items = await resolveItems(location.id, KITCHEN_ITEMS);
  const who = await actor("staff");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const supplier = await prisma.supplier.findFirst({ where: { name: supplierName, client: { name: clientName } } });

  const purchase = await prisma.purchase.create({
    data: {
      locationId: location.id, purchaseDate: "2026-07-20", supplierId: supplier?.id ?? null,
      refNo: `${refPrefix}-0721-1`, status: "COMMITTED", committedAt: new Date(), committedById: manager.id, ...who,
    },
  });
  for (const [key, qty, unitCost] of [["chicken", 12, 190], ["fries", 15, 117], ["salmon", 4, 655]] as Array<[KitchenKey, number, number]>) {
    await prisma.purchaseLine.create({
      data: { purchaseId: purchase.id, locationItemId: items[key].id, qty, unitCost, lineTotal: round2(qty * unitCost), ...who },
    });
  }

  // Recipe sales, one discounted — Sales report + Top Sellers menus/ingredients.
  for (const [i, name] of menuNames.entries()) {
    const mv = await latestMenuVersion(location.id, name);
    if (!mv) continue;
    await prisma.saleRecord.create({
      data: {
        locationId: location.id, saleDate: i === 0 ? "2026-07-20" : "2026-07-21", kind: "SALE",
        menuItemId: mv.menuId, recipeVersionId: mv.versionId, qty: 8 - i * 2, unitPrice: mv.srp,
        discountPct: i === 1 ? 10 : 0, ...who,
      },
    });
  }

  // A trimming write-off (Non-Revenue) and a prep batch (Production).
  await prisma.saleRecord.create({
    data: { locationId: location.id, saleDate: "2026-07-20", kind: "NON_REVENUE", locationItemId: items.chicken.id, qty: 0.6, unitPrice: 0, reason: "TRIMMING", ...who },
  });
  await prisma.saleRecord.create({
    data: { locationId: location.id, saleDate: "2026-07-21", kind: "PRODUCTION", locationItemId: items.oil.id, qty: 1, unitPrice: 0, ...who },
  });
  return true;
}

async function seedRicherActivity() {
  const location = await locationOf("Prime Hospitality Group", "Main Bar");
  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager" } });
  const rows: Array<[string, string, string]> = [
    ["count.commit", "CountSession", "Committed the 2026-07-20 closing count (12 items)"],
    ["purchase.commit", "Purchase", "Committed BAR-0721-1 from Metro Beverage Distribution"],
    ["transfer.commit", "Transfer", "Dispatched 18 San Miguel Pale Pilsen to Depot"],
    ["transfer.receive", "Transfer", "Depot confirmed 15 of 18 — 3 short on arrival"],
    ["recipe.publish", "RecipeVersion", "Published Vodka Tonic v2 at ₱280 SRP"],
    ["supplier.update", "Supplier", "Set payment terms for Bar Essentials Supply to C.O.D."],
    ["report.export", "Report", "Exported Ending Cost Report (weighted average) to Excel"],
    ["settings.costBasis", "Setting", "Reviewed inventory cost basis policy"],
  ];
  for (const [action, entity, summary] of rows) {
    const exists = await prisma.activityLog.findFirst({ where: { locationId: location.id, action, summary } });
    if (exists) continue;
    await prisma.activityLog.create({
      data: {
        userId: manager.id, userName: "Maria Santos", clientId: location.clientId,
        locationId: location.id, action, entity, summary,
      },
    });
  }
}

/**
 * A dedicated dead-stock item (client req 2026-07-21) so the Non-Moving report
 * has something to show: stocked, but counted at the SAME quantity on the last
 * closed period's boundaries (2026-07-14 and 07-20) with no sales — so its
 * usage is zero and it lands on the report with value sitting idle. A brand-new
 * item the ledger never touches, so it disturbs nothing else (its variance is
 * zero, so no grand total moves). Idempotent.
 */
async function seedDeadStock(
  clientName: string,
  locationName: string,
  spec: { item: string; category: string; size: number; unit: string; cost: number; retail: number; qty: number },
) {
  const location = await locationOf(clientName, locationName);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const who = await actor("staff");
  const category = await prisma.category.findUnique({ where: { name: spec.category } });
  const unit = await prisma.unit.findUnique({ where: { name: spec.unit } });
  if (!category || !unit) return;

  const item =
    (await prisma.item.findFirst({ where: { name: spec.item } })) ??
    (await prisma.item.create({ data: { name: spec.item, categoryId: category.id, createdById: admin.id } }));
  const variant = await prisma.itemVariant.upsert({
    where: { itemId_size_unitId: { itemId: item.id, size: spec.size, unitId: unit.id } },
    update: {},
    create: { itemId: item.id, size: spec.size, unitId: unit.id, contentTracked: false },
  });
  const li = await prisma.locationItem.upsert({
    where: { locationId_itemVariantId: { locationId: location.id, itemVariantId: variant.id } },
    update: { cost: spec.cost, retail: spec.retail },
    create: { locationId: location.id, itemVariantId: variant.id, cost: spec.cost, retail: spec.retail, parLevel: null },
  });

  // Equal counts on the latest closed period's boundaries → zero movement.
  for (const date of ["2026-07-14", "2026-07-20"]) {
    const session = await prisma.countSession.findFirst({
      where: { locationId: location.id, countDate: date, status: "COMMITTED" },
    });
    if (!session) continue;
    const exists = await prisma.countLine.findFirst({ where: { countSessionId: session.id, locationItemId: li.id } });
    if (exists) continue;
    await prisma.countLine.create({
      data: {
        countSessionId: session.id,
        locationItemId: li.id,
        countType: "FULL",
        qtyFull: spec.qty,
        remainingContent: 0,
        unitCost: li.cost,
        unitRetail: li.retail,
        createdById: who.createdById,
        createdByName: who.createdByName,
      },
    });
  }
}

/**
 * Turns on the ASSET module for a demo client and stocks a small equipment
 * register with breakage (client req 2026-07-21), so the Asset Breakage report
 * has data. Assets aren't consumed — they leave the register when they break,
 * go missing, or are retired, recorded as non-revenue with a "what happened"
 * note. Opening (07-14) and closing (07-20) counts differ by exactly the
 * breakage, so the period reconciles to zero variance. Idempotent; a brand-new
 * location, so no fixture is touched.
 */
async function seedAssets() {
  const prime = await prisma.client.findFirst({ where: { name: "Prime Hospitality Group" } });
  if (!prime) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const manager = await actor("manager");
  const staff = await actor("staff");

  // 1. Prime's subscription gains the ASSET module.
  const sub = await prisma.subscription.findUnique({ where: { clientId: prime.id } });
  if (sub) {
    await prisma.subscriptionModule.upsert({
      where: { subscriptionId_module: { subscriptionId: sub.id, module: "ASSET" } },
      update: {},
      create: { subscriptionId: sub.id, module: "ASSET" },
    });
  }

  // 2. A dedicated asset location with the ASSET module.
  const location =
    (await prisma.location.findFirst({ where: { clientId: prime.id, name: "Bar Equipment" } })) ??
    (await prisma.location.create({ data: { clientId: prime.id, name: "Bar Equipment", kind: "STOCKROOM" } }));
  await prisma.locationModule.upsert({
    where: { locationId_module: { locationId: location.id, module: "ASSET" } },
    update: {},
    create: { locationId: location.id, module: "ASSET" },
  });

  const category = await prisma.category.findUnique({ where: { name: "Equipment" } });
  const pc = await prisma.unit.findUnique({ where: { name: "pc" } });
  if (!category || !pc) return;

  // Committed opening (07-14) and closing (07-20) counts for this location.
  const ensureSession = async (date: string) => {
    const found = await prisma.countSession.findFirst({
      where: { locationId: location.id, countDate: date, status: "COMMITTED" },
    });
    if (found) return found;
    return prisma.countSession.create({
      data: {
        locationId: location.id, countDate: date, name: "Equipment count", status: "COMMITTED",
        committedAt: new Date(), committedById: manager.createdById,
        createdById: manager.createdById, createdByName: manager.createdByName,
      },
    });
  };
  const open = await ensureSession("2026-07-14");
  const close = await ensureSession("2026-07-20");

  type Breakage = { date: string; qty: number; reason: string; note: string };
  const ASSETS: Array<{ name: string; cost: number; begin: number; breakage: Breakage[] }> = [
    {
      // Breakage is dated in the OPEN period (after the 07-20 count), so it lands
      // in the report's default range and reduces current on-hand.
      name: "Wine Glass", cost: 85, begin: 48, breakage: [
        { date: "2026-07-21", qty: 2, reason: "BREAKAGE", note: "Shattered in the dishwasher" },
        { date: "2026-07-22", qty: 1, reason: "BREAKAGE", note: "Dropped at table 6 during service" },
      ],
    },
    {
      name: "Highball Glass", cost: 70, begin: 36, breakage: [
        { date: "2026-07-21", qty: 1, reason: "LOST", note: "Unaccounted for after a private function" },
      ],
    },
    {
      name: "Cocktail Shaker", cost: 450, begin: 6, breakage: [
        { date: "2026-07-22", qty: 1, reason: "RETIRED", note: "Lid cracked — disposed" },
      ],
    },
    { name: "Bar Blender", cost: 3200, begin: 2, breakage: [] },
  ];

  for (const a of ASSETS) {
    const item =
      (await prisma.item.findFirst({ where: { name: a.name } })) ??
      (await prisma.item.create({ data: { name: a.name, categoryId: category.id, createdById: admin.id } }));
    const variant = await prisma.itemVariant.upsert({
      where: { itemId_size_unitId: { itemId: item.id, size: 1, unitId: pc.id } },
      update: {},
      create: { itemId: item.id, size: 1, unitId: pc.id, contentTracked: false },
    });
    const li = await prisma.locationItem.upsert({
      where: { locationId_itemVariantId: { locationId: location.id, itemVariantId: variant.id } },
      update: { cost: a.cost, retail: 0 },
      create: { locationId: location.id, itemVariantId: variant.id, cost: a.cost, retail: 0, parLevel: null },
    });
    // Both boundary counts equal the opening quantity — nothing broke inside the
    // closed period, so it reconciles to zero variance; the breakage sits after.
    for (const session of [open, close]) {
      const exists = await prisma.countLine.findFirst({ where: { countSessionId: session.id, locationItemId: li.id } });
      if (exists) continue;
      await prisma.countLine.create({
        data: {
          countSessionId: session.id, locationItemId: li.id, countType: "FULL", qtyFull: a.begin,
          remainingContent: 0, unitCost: li.cost, unitRetail: li.retail,
          createdById: manager.createdById, createdByName: manager.createdByName,
        },
      });
    }
    for (const b of a.breakage) {
      const exists = await prisma.saleRecord.findFirst({
        where: { locationId: location.id, locationItemId: li.id, kind: "NON_REVENUE", saleDate: b.date, reason: b.reason, note: b.note },
      });
      if (exists) continue;
      await prisma.saleRecord.create({
        data: { locationId: location.id, saleDate: b.date, kind: "NON_REVENUE", locationItemId: li.id, qty: b.qty, unitPrice: 0, reason: b.reason, note: b.note, ...staff },
      });
    }
  }
}

/**
 * Top-up entries that make the newest features visible in the demo even on a
 * database seeded before they existed (client req 2026-07-21). Idempotent and
 * additive — each guard checks for its own row, so a reseed adds nothing twice
 * and it runs whether or not the open-period seeders above skipped:
 *  - an "Other / Unspecified" non-revenue on each sales location, so the
 *    Non-Revenue report's By-Bucket breakdown shows all four buckets (the three
 *    canonical ones plus Other). Dated inside the open period, after every
 *    fixture window, so no golden number moves.
 *  - a dead-stock item per sales location (via seedDeadStock) so the Non-Moving
 *    report has rows to show.
 */
async function seedFeatureShowcase() {
  const who = await actor("staff");

  const bar = await locationOf("Prime Hospitality Group", "Main Bar");
  if (!(await prisma.saleRecord.findFirst({ where: { locationId: bar.id, kind: "NON_REVENUE", reason: "OTHER" } }))) {
    const items = await resolveItems(bar.id, BAR_ITEMS);
    await prisma.saleRecord.create({
      data: { locationId: bar.id, saleDate: "2026-07-20", kind: "NON_REVENUE", locationItemId: items.cola1.id, qty: 1, unitPrice: 0, reason: "OTHER", ...who },
    });
  }

  for (const [clientName, locationName] of [
    ["Prime Hospitality Group", "Kitchen"],
    ["Casa Verde Restaurant", "Main"],
  ] as const) {
    const location = await locationOf(clientName, locationName);
    if (await prisma.saleRecord.findFirst({ where: { locationId: location.id, kind: "NON_REVENUE", reason: "OTHER" } })) continue;
    const items = await resolveItems(location.id, KITCHEN_ITEMS);
    await prisma.saleRecord.create({
      data: { locationId: location.id, saleDate: "2026-07-21", kind: "NON_REVENUE", locationItemId: items.fries.id, qty: 0.5, unitPrice: 0, reason: "OTHER", ...who },
    });
  }

  // Dead stock — one idle item per sales location so the Non-Moving report lists
  // something. A dusty bottle of Blue Curaçao behind the bar; a jar of truffle
  // paste in each kitchen — bought, counted, never used.
  await seedDeadStock("Prime Hospitality Group", "Main Bar", { item: "Blue Curaçao", category: "Liqueur", size: 750, unit: "ml", cost: 480, retail: 950, qty: 6 });
  await seedDeadStock("Prime Hospitality Group", "Kitchen", { item: "Truffle Paste", category: "Sauces & Dressings", size: 1, unit: "kg", cost: 1850, retail: 0, qty: 3 });
  await seedDeadStock("Casa Verde Restaurant", "Main", { item: "Truffle Paste", category: "Sauces & Dressings", size: 1, unit: "kg", cost: 1850, retail: 0, qty: 3 });
}

export async function seedDemoHistory() {
  // Transfers first: the Main Bar ledger reads them back when it decides each
  // closing count, so they have to exist before it runs.
  const transfers = await seedMoreTransfers();
  const bar = await seedMainBar();
  const depot = await seedDepot();
  const kitchen = await seedKitchen();
  const casa = await seedCasaVerde();
  const open = await seedOpenPeriod();
  const kitchenOpen = await seedFoodOpenPeriod(
    "Prime Hospitality Group", "Kitchen", "KITCH", "FreshFoods Corp",
    ["Grilled Chicken Plate", "Ribeye Steak Plate", "Pan-Seared Salmon"],
  );
  const casaOpen = await seedFoodOpenPeriod(
    "Casa Verde Restaurant", "Main", "CV", "Verde Fresh Market",
    ["Chicken Adobo Rice Bowl", "Grilled Salmon Verde", "Truffle Fries"],
  );
  await seedRicherActivity();
  await seedFeatureShowcase();
  await seedAssets();

  const done = [
    transfers && "transfers", bar && "Main Bar", depot && "Depot", kitchen && "Kitchen",
    casa && "Casa Verde", open && "open period",
    (kitchenOpen || casaOpen) && "food open periods",
  ].filter(Boolean);
  console.log(
    done.length > 0
      ? `Demo history seeded (${done.join(", ")}) — 5 audit periods, 2026-06-15 → 2026-07-20.`
      : "Demo history already present — nothing to add.",
  );
}
