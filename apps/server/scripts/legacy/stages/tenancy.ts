/**
 * Stage 2 — tenancy: clients, locations, modules, subscriptions, users.
 *
 * Legacy `clients` conflates business and venue. The rebuild separates Client
 * (tenant: roles, suppliers, aliases, subscription, billing) from Location
 * (venue), so six legacy branches become three Clients with five Locations.
 */
import type { Stage } from "../../import-legacy";
import { derivePackageType, REPORT_TIER_PRESETS } from "@fnb/core";
import { query } from "../source";
import { record } from "../map";

/**
 * The whole tenancy decision, as data.
 *
 * Mansion branches 73 and 74 are ONE venue: 74 shares 308 of its 308 catalog
 * items with 73 and exists only to hold a second audit cadence, which the
 * rebuild expresses as a date range rather than a second tenant.
 *
 * Client "Xylo" is SYNTHESISED — legacy has no parent row, only "Xylo Bar" (55)
 * and "Xylo Kitchen" (49) as separate clients. Both legacy ids are recorded
 * against the one new Client.
 *
 * Grouping a bar and a kitchen under one Client is the pattern seed.ts:1497
 * documents as real and supported, not a collapse to be undone later.
 */
export const LOCATION_PLAN = [
  { client: "Mansion Sports Bar & Lounge", location: "Sports Bar", branches: ["73", "74"], module: "BAR", legacyClients: ["35", "36"] },
  { client: "Mansion Sports Bar & Lounge", location: "Kitchen", branches: ["90"], module: "KITCHEN", legacyClients: ["52"] },
  { client: "Xylo", location: "Bar", branches: ["93"], module: "BAR", legacyClients: ["55"] },
  { client: "Xylo", location: "Kitchen", branches: ["87"], module: "KITCHEN", legacyClients: ["49"] },
  { client: "Sample Kitchen", location: "Main", branches: ["88"], module: "KITCHEN", legacyClients: ["50"] },
  // Added 2026-08-23 after the dry run surfaced it: 164 catalog rows, comparable
  // to Xylo Bar's 193, but almost no counts or sales — so it did not appear in
  // the count/sale-ranked table the original scoping decision was made from.
  // Entirely category_type 2 (Red Wine 47, White Wine 14, Gin, Tequila, Whisky,
  // Soda, Liquer, Rum), hence BAR.
  { client: "Pablo/Cartel", location: "Main", branches: ["94"], module: "BAR", legacyClients: ["56"] },
] as const;

/** Legacy branch id -> "<client>::<location>". Derived, never hand-maintained. */
export const BRANCH_TO_LOCATION = new Map<string, string>(
  LOCATION_PLAN.flatMap((p) => p.branches.map((b) => [b, `${p.client}::${p.location}`] as const)),
);

/** Every branch this migration deliberately imports. */
export const MIGRATED_BRANCHES = new Set(BRANCH_TO_LOCATION.keys());

/**
 * Cannot be produced by hashPassword(), which emits `scrypt:N:r:p:salt:key`.
 * verifyPassword() rejects anything without exactly 6 colon-separated parts
 * starting "scrypt" (src/auth/password.ts) — verified, not assumed.
 */
const UNUSABLE_HASH = "!migrated-no-credential";

type LegacyUser = { user_id: number; username: string; user_level: number; status: number };
type LegacyClient = { client_id: number; client_name: string; status: number };
type LegacyBranch = { branch_id: number; branch_name: string; client_id: number };

/**
 * Every location this migration owns, for scoping ledger entries. Reads
 * LegacyMap rather than names so it reflects what was actually created.
 */
export async function migratedLocations(tx: Parameters<Stage["run"]>[0]) {
  const branches = await tx.legacyMap.findMany({ where: { legacyTable: "branches" }, select: { newId: true } });
  const ids = [...new Set(branches.map((b) => b.newId))];
  const locs = await tx.location.findMany({ where: { id: { in: ids } }, select: { id: true, clientId: true } });
  return locs.map((l) => ({ clientId: l.clientId, locationId: l.id }));
}

export const tenancyStage: Stage = {
  name: "tenancy",
  touched: migratedLocations,
  async run(tx, report, adminId) {
    const today = new Date().toISOString().slice(0, 10);

    // ── Clients ───────────────────────────────────────────────────────────
    const clientIdByName = new Map<string, string>();
    for (const name of new Set(LOCATION_PLAN.map((p) => p.client))) {
      const existing = await tx.client.findFirst({ where: { name }, select: { id: true } });
      const id = existing
        ? existing.id
        : (await tx.client.create({ data: { name, status: "ACTIVE" }, select: { id: true } })).id;
      clientIdByName.set(name, id);
      report.count(existing ? "Client (matched existing)" : "Client (created)");

      for (const legacyId of LOCATION_PLAN.filter((p) => p.client === name).flatMap((p) => p.legacyClients)) {
        await record(tx, "clients", legacyId, id);
      }
    }

    // ── Locations + modules ───────────────────────────────────────────────
    for (const plan of LOCATION_PLAN) {
      const clientId = clientIdByName.get(plan.client)!;
      const existing = await tx.location.findFirst({
        where: { clientId, name: plan.location },
        select: { id: true },
      });
      const locationId = existing
        ? existing.id
        : (
            await tx.location.create({
              data: { clientId, name: plan.location, kind: "MAIN", status: "ACTIVE" },
              select: { id: true },
            })
          ).id;
      report.count(existing ? "Location (matched existing)" : "Location (created)");

      await tx.locationModule.upsert({
        where: { locationId_module: { locationId, module: plan.module } },
        update: {},
        create: { locationId, module: plan.module },
      });
      report.count("LocationModule");

      for (const branch of plan.branches) await record(tx, "branches", branch, locationId);
      if (plan.branches.length > 1) {
        report.flag(
          `Location "${plan.client} / ${plan.location}" merges legacy branches ${plan.branches.join(" + ")}. ` +
            `Their catalogs overlap 308/308 and they collide on exactly one count date (2023-05-01), ` +
            `handled in the pricing and counts stages.`,
        );
      }
    }

    // ── Subscriptions ─────────────────────────────────────────────────────
    for (const [name, clientId] of clientIdByName) {
      const plans = LOCATION_PLAN.filter((p) => p.client === name);
      const modules = [...new Set(plans.map((p) => p.module))];
      const existing = await tx.subscription.findUnique({ where: { clientId }, select: { id: true } });
      if (existing) {
        report.count("Subscription (matched existing)");
        continue;
      }
      // Conservative placeholders: 1 user, 1 device. packageType is DERIVED
      // from them, not asserted — derivePackageType() is the codebase's own rule
      // and asserting a tier here would let the badge disagree with the limits.
      const billingCycle = "MONTHLY";
      const maxUsers = 1;
      const packageType = derivePackageType(billingCycle, plans.length, maxUsers);

      const sub = await tx.subscription.create({
        data: {
          clientId,
          packageType,
          billingCycle,
          maxEntities: plans.length,
          maxUsers,
          maxDevices: 1,
          startDate: today,
          status: "ACTIVE",
          paid: false,
          createdById: adminId,
          note: "Created by legacy migration — commercial terms not set.",
          modules: { create: modules.map((module) => ({ module })) },
          // Report tier gating. seed.ts:196-202 calls REPORT_TIER_PRESETS "one
          // source for all three paths so they can never drift apart" — seeding,
          // real subscription creation (routes/admin.ts) and the Phase 6.1
          // backfill. This migration is the fourth path and uses the same source.
          // Without these rows every report is dark for every non-ADMIN role,
          // which is the exact failure that backfill exists to prevent.
          reports: { create: REPORT_TIER_PRESETS[packageType].map((reportSlug) => ({ reportSlug })) },
        },
        select: { id: true },
      });
      report.count("Subscription (created)");
      report.count("SubscriptionModule", modules.length);
      report.count("SubscriptionReport", REPORT_TIER_PRESETS[packageType].length);
      report.flag(
        `Subscription for "${name}": packageType/maxUsers/maxDevices/negotiatedPrice are commercial ` +
          `decisions the importer cannot know. Currently ${packageType}/${billingCycle}, ` +
          `maxEntities=${plans.length}, maxUsers=${maxUsers}, maxDevices=1, modules ${modules.join("+")}. ` +
          `Changing maxUsers re-derives packageType, which changes the enabled report set. ` +
          `Set the real terms in Admin before go-live.`,
      );
    }

    // ── Users ─────────────────────────────────────────────────────────────
    const users = query<LegacyUser>(`
      SELECT JSON_OBJECT('user_id', user_id, 'username', username,
                         'user_level', user_level, 'status', status)
      FROM users ORDER BY user_id
    `);
    for (const u of users) {
      const username = `legacy_${u.username}`;
      const existing = await tx.user.findUnique({ where: { username }, select: { id: true } });
      if (existing) {
        await record(tx, "users", u.user_id, existing.id);
        report.count("User (matched existing)");
        continue;
      }
      const created = await tx.user.create({
        data: {
          username,
          passwordHash: UNUSABLE_HASH,
          firstName: u.username,
          lastName: "(migrated)",
          // Lowest role in @fnb/core ROLES: reports.view and nothing else.
          role: "AUDIT_VIEWER_LIMITED",
          status: "DISABLED",
        },
        select: { id: true },
      });
      await record(tx, "users", u.user_id, created.id);
      report.count("User (created, DISABLED)");
      report.flag(
        `User "${username}" imported DISABLED at AUDIT_VIEWER_LIMITED with no usable password. ` +
          `Legacy user_level ${u.user_level} is undocumented (only values 1 and 2 exist, with no ` +
          `record of their meaning) — assign the real role and enable deliberately. No ` +
          `UserClientAccess row was created either, so it currently sees nothing.`,
      );
    }

    // ── Everything deliberately not imported ──────────────────────────────
    // Every exclusion carries its DATA VOLUME. "None silent" means a reader can
    // see what is being dropped and disagree — a bare name tells them nothing.
    const clients = query<LegacyClient & { catalog: number; counts: number; sales: number; menus: number }>(`
      SELECT JSON_OBJECT(
        'client_id', c.client_id, 'client_name', c.client_name, 'status', c.status,
        'catalog', (SELECT COUNT(*) FROM client_bottles x JOIN branches b2 ON b2.branch_id=x.branch_id WHERE b2.client_id=c.client_id),
        'counts',  (SELECT COUNT(*) FROM client_bottle_audits x JOIN branches b2 ON b2.branch_id=x.branch_id WHERE b2.client_id=c.client_id),
        'sales',   (SELECT COUNT(*) FROM client_sales x JOIN branches b2 ON b2.branch_id=x.branch_id WHERE b2.client_id=c.client_id),
        'menus',   (SELECT COUNT(*) FROM client_menus x JOIN branches b2 ON b2.branch_id=x.branch_id WHERE b2.client_id=c.client_id)
      ) FROM clients c ORDER BY c.client_id
    `);
    const kept = new Set<string>(LOCATION_PLAN.flatMap((p) => [...p.legacyClients]));
    // Named, not inferred. copyTest/anotherTest/theTest each hold ~170 catalog
    // rows and 87 menus because they are COPIES of a real client — the volume
    // looks real and means nothing, so a volume heuristic alone would flag them
    // forever. The names are the evidence.
    const TEST_CLIENT_IDS = new Set(["57", "58", "59"]);

    for (const c of clients) {
      const id = String(c.client_id);
      if (kept.has(id)) continue;
      const vol = `catalog ${c.catalog}, counts ${c.counts}, sales ${c.sales}, menus ${c.menus}`;

      if (TEST_CLIENT_IDS.has(id)) {
        report.skip("test-client", `${c.client_name} (client_id ${id}) — ${vol}`);
        continue;
      }

      report.skip("client-not-migrated", `${c.client_name} (client_id ${id}) — ${vol}`);
      // A dropped client that still holds a real catalog is a decision, not
      // housekeeping. Surface it where it cannot be scrolled past.
      if (c.catalog >= 50) {
        report.flag(
          `NOT MIGRATED but holds a real catalog: "${c.client_name}" — ${vol}. The scoping decision ` +
            `named six branches ranked by count/sale volume, and this one did not rank there — but its ` +
            `catalog is comparable to migrated venues. Confirm this is intended; if not, add it to ` +
            `LOCATION_PLAN and re-run.`,
        );
      }
    }

    const orphans = query<LegacyBranch>(`
      SELECT JSON_OBJECT('branch_id', b.branch_id, 'branch_name', b.branch_name, 'client_id', b.client_id)
      FROM branches b LEFT JOIN clients c ON c.client_id = b.client_id
      WHERE c.client_id IS NULL
    `);
    for (const b of orphans) {
      report.skip("orphan-branch", `branch ${b.branch_id} -> client_id ${b.client_id} (no clients row)`);
    }
  },
};
