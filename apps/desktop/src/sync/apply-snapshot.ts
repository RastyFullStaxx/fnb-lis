import type Database from "better-sqlite3";

/**
 * Write a pulled snapshot into the local mirror.
 *
 * MERGE, not replace. The obvious implementation — wipe the tables and reinsert
 * — would destroy any record still sitting in the outbox, which is precisely
 * the work the device is trying to protect. So every row is upserted, and rows
 * the outbox still references are never deleted.
 *
 * Written with raw SQL rather than Prisma on purpose: this is a bulk load of
 * ~40 tables where the shapes come straight off the wire, and per-model Prisma
 * upserts would be forty hand-maintained mappings that drift the moment a
 * column is added. Column names are read from the LOCAL schema, so a field the
 * server sends that this build does not know about is dropped rather than
 * crashing — which is what lets a device run a version behind the server.
 */

/** Snapshot key → local table. Order matters: parents before children (FKs). */
const TABLES: Array<[key: string, table: string, nested?: Array<[string, string]>]> = [
  ["master.units", "Unit"],
  ["master.categories", "Category"],
  // Item is handled separately, BEFORE this — it is a PARENT of ItemVariant,
  // not a child, even though the payload nests it inside one.
  ["master.variants", "ItemVariant"],
  ["catalog", "LocationItem"],
  ["suppliers", "Supplier"],
  ["menuItems", "MenuItem", [["versions", "RecipeVersion"]]],
  ["counts", "CountSession", [["lines", "CountLine"]]],
  ["purchases", "Purchase", [["lines", "PurchaseLine"]]],
  ["sales", "SaleRecord"],
  ["forfeits", "Forfeit"],
  ["transfers", "Transfer", [["lines", "TransferLine"]]],
  ["people", "User"],
  ["identity.locationModules", "LocationModule"],
  ["identity.clientAccess", "UserClientAccess"],
  ["identity.userModules", "UserModule"],
];

function pick(payload: Record<string, unknown>, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], payload);
}

/** Columns this build's schema actually has, so unknown server fields are dropped. */
function columnsOf(db: Database.Database, table: string): Set<string> {
  try {
    return new Set(
      (db.pragma(`table_info("${table}")`) as Array<{ name: string }>).map((c) => c.name),
    );
  } catch {
    return new Set();
  }
}

/**
 * A password hash that can never validate.
 *
 * `User.passwordHash` is NOT NULL, but the snapshot deliberately never carries
 * hashes — shipping them would make a stolen bar PC into remote access to the
 * web app. The mirror still needs the User rows, for names on records and for
 * the access checks the server's own middleware runs.
 *
 * So local users get this sentinel. `verifyPassword` (auth/password.ts) splits
 * on ":" and requires six parts beginning "scrypt"; this has none, so it
 * returns false without even hashing. The effect is that the LOCAL server
 * cannot authenticate anybody by password at all — which is not a workaround,
 * it is the offline design enforced by construction: the only way in is the
 * device PIN.
 */
const NO_LOCAL_PASSWORD = "!offline-no-password";

/** Columns the local schema requires that the snapshot intentionally omits. */
const LOCAL_DEFAULTS: Record<string, Record<string, unknown>> = {
  User: { passwordHash: NO_LOCAL_PASSWORD },
};

/**
 * Ids the merge must leave alone for the duration of one applySnapshot call.
 *
 * Module-scoped rather than threaded through every call site: `upsertRows` is
 * invoked from a dozen places inside the merge transaction, and an extra
 * argument on each is more surface to forget than one value set at the entry
 * point and cleared in a finally.
 */
let protectedIds: Set<string> | null = null;
let skipped = 0;

function upsertRows(db: Database.Database, table: string, rows: unknown[]): number {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const cols = columnsOf(db, table);
  if (cols.size === 0) return 0;

  let written = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    // Never overwrite a row this device is still holding. The server's copy is
    // by definition older than the local edit that has not been pushed yet, and
    // INSERT OR REPLACE would discard it without a trace.
    const rowId = (row as Record<string, unknown>).id;
    if (protectedIds && typeof rowId === "string" && protectedIds.has(rowId)) {
      skipped++;
      continue;
    }
    const withDefaults = { ...(LOCAL_DEFAULTS[table] ?? {}), ...(row as Record<string, unknown>) };
    const entries = Object.entries(withDefaults).filter(
      // `typeof null === "object"`, so nulls would be dropped — keep them, they
      // are meaningful (a cleared override is not the same as an absent one).
      ([k, v]) => cols.has(k) && (v === null || typeof v !== "object"),
    );
    // Dates arrive as ISO strings and booleans as true/false; SQLite takes both
    // as TEXT/INTEGER, and Prisma reads them back correctly because the column
    // affinity is what decides.
    const values = entries.map(([, v]) => (typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null)));
    const names = entries.map(([k]) => `"${k}"`).join(", ");
    const holes = entries.map(() => "?").join(", ");
    db.prepare(`INSERT OR REPLACE INTO "${table}" (${names}) VALUES (${holes})`).run(...values);
    written++;
  }
  return written;
}

export interface ApplyResult {
  tables: Record<string, number>;
  total: number;
  /** Rows left untouched because this device still holds unpushed work on them. */
  skipped: number;
}

export function applySnapshot(
  db: Database.Database,
  payload: Record<string, unknown>,
  keepLocal?: Set<string>,
): ApplyResult {
  const tables: Record<string, number> = {};
  protectedIds = keepLocal && keepLocal.size > 0 ? keepLocal : null;
  skipped = 0;

  /**
   * Foreign keys OFF for the merge, and this is not laziness.
   *
   * A mirror is a PARTIAL view of the server's database, so some references
   * legitimately dangle. The clearest case: a transfer this location dispatched
   * carries receipt lines pointing at the DESTINATION's catalog rows, and the
   * destination is a different location whose catalog this snapshot rightly does
   * not include. Enforcing FKs would reject real, correct data.
   *
   * Safe because the server assembled this payload from one consistent read, so
   * internal consistency is guaranteed upstream rather than re-derived here.
   * Restored afterwards so ordinary local writes are still checked.
   *
   * Must be set outside the transaction — SQLite ignores the pragma inside one.
   */
  db.pragma("foreign_keys = OFF");

  const run = db.transaction(() => {
    // Items first: parents of ItemVariant, delivered nested inside them.
    const variants = pick(payload, "master.variants");
    if (Array.isArray(variants)) {
      tables.Item = upsertRows(
        db,
        "Item",
        variants.map((v) => (v as Record<string, unknown>).item).filter(Boolean),
      );
    }

    // Singletons first — Client and Location are what requireLocationAccess
    // reads on every request, so a mirror without them 404s everything.
    for (const [key, table] of [
      ["client", "Client"],
      ["location", "Location"],
      ["identity.subscription", "Subscription"],
    ] as const) {
      const one = pick(payload, key);
      if (one) tables[table] = upsertRows(db, table, [one]);
    }

    /**
     * Drop sessions whose user is not in this mirror.
     *
     * A device re-provisioned against a REBUILT server keeps its old
     * `AuthSession` rows — they were issued by a database whose user ids no
     * longer exist, so they can never authenticate anyone again. They are not
     * merely useless: `getSessionUser` joins to `User`, and with foreign keys
     * deliberately off (see above) that join yields null rather than an error,
     * which turned every request into a 500 and replaced the whole app with
     * `{"error":"Internal server error"}`.
     *
     * Scoped to provably-dead rows — `userId NOT IN (SELECT id FROM User)` —
     * so a live session is never touched and this is safe on every pull, not
     * just the first one.
     */
    db.prepare(`DELETE FROM "AuthSession" WHERE "userId" NOT IN (SELECT "id" FROM "User")`).run();

    for (const [key, table, nested] of TABLES) {
      const rows = pick(payload, key);
      if (!Array.isArray(rows)) continue;
      tables[table] = (tables[table] ?? 0) + upsertRows(db, table, rows);

      for (const [childKey, childTable] of nested ?? []) {
        const children = rows.flatMap((r) => {
          const c = (r as Record<string, unknown>)[childKey];
          return Array.isArray(c) ? c : c ? [c] : [];
        });
        tables[childTable] = (tables[childTable] ?? 0) + upsertRows(db, childTable, children);
        // Recipe lines hang off recipe versions, one level deeper.
        if (childTable === "RecipeVersion") {
          const lines = children.flatMap((v) => {
            const l = (v as Record<string, unknown>).lines;
            return Array.isArray(l) ? l : [];
          });
          tables.RecipeLine = (tables.RecipeLine ?? 0) + upsertRows(db, "RecipeLine", lines);
        }
        // Transfer receipts hang off transfer lines.
        if (childTable === "TransferLine") {
          const receipts = children.flatMap((l) => {
            const r = (l as Record<string, unknown>).receipts;
            return Array.isArray(r) ? r : [];
          });
          tables.TransferReceiptLine =
            (tables.TransferReceiptLine ?? 0) + upsertRows(db, "TransferReceiptLine", receipts);
        }
      }
    }

    // Device PIN hashes travel nested under each person.
    const people = pick(payload, "people");
    if (Array.isArray(people)) {
      const pins = people
        .map((p) => {
          const dp = (p as Record<string, unknown>).devicePin as Record<string, unknown> | null;
          return dp ? { ...dp, userId: (p as Record<string, unknown>).id } : null;
        })
        .filter(Boolean);
      tables.DevicePin = upsertRows(db, "DevicePin", pins as unknown[]);
    }
  });
  try {
    run();
  } finally {
    db.pragma("foreign_keys = ON");
    protectedIds = null;
  }

  return { tables, total: Object.values(tables).reduce((a, b) => a + b, 0), skipped };
}
