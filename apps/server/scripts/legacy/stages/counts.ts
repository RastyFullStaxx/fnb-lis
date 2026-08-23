/**
 * Stage 6 — count sessions and lines. The hardest stage.
 *
 * Legacy has NO session concept: client_bottle_audits rows are loose, keyed by
 * (bottle, branch, date). The rebuild anchors every Full Audit on a COMMITTED
 * CountSession, so sessions have to be synthesised — and how they are grouped
 * decides every historical anchor.
 */
import type { Stage } from "../../import-legacy";
import { query } from "../source";
import { loadMap, record } from "../map";
import { mapUom, unmappableReason } from "../units";
import { migratedLocations } from "./tenancy";

type LegacyAudit = {
  client_bottle_audit_id: number;
  branch_id: number;
  bottle_id: number;
  bottle_size: number;
  bottle_uom: string | null;
  qty: string | number | null;
  scale_weight: string | number | null;
  tare_weight: string | number | null;
  liquid_weight: string | number | null;
  remaining_ml: string | number | null;
  default_cost: string | number | null;
  audit_type: number;
  is_deleted: number;
  date_audit: string | null;
};

const variantKey = (bottleId: number, size: number, uom: string) => `${bottleId}|${size}|${uom.toLowerCase()}`;

export const countsStage: Stage = {
  name: "counts",
  touched: migratedLocations,
  async run(tx, report, adminId) {
    const branchMap = await loadMap(tx, "branches");
    const variantMap = await loadMap(tx, "bottle_sizes");
    if (branchMap.size === 0 || variantMap.size === 0) {
      throw new Error(
        [
          "Missing prerequisites in LegacyMap. Run these first, with --confirm:",
          "  --stage=reference --stage=tenancy --stage=catalog --stage=pricing",
        ].join("\n"),
      );
    }

    const rows = query<LegacyAudit>(`
      SELECT JSON_OBJECT(
        'client_bottle_audit_id', client_bottle_audit_id, 'branch_id', branch_id,
        'bottle_id', bottle_id, 'bottle_size', bottle_size, 'bottle_uom', bottle_uom,
        'qty', qty, 'scale_weight', scale_weight, 'tare_weight', tare_weight,
        'liquid_weight', liquid_weight, 'remaining_ml', remaining_ml,
        'default_cost', default_cost, 'audit_type', audit_type, 'is_deleted', is_deleted,
        -- Formatted in SQL, never through a JS Date: business dates are TEXT
        -- YYYY-MM-DD and a Date round-trip can shift them by a timezone.
        'date_audit', DATE_FORMAT(date_audit, '%Y-%m-%d')
      ) FROM client_bottle_audits
      -- branch 73 before 74 so the Mansion merge keeps 73's session on the one
      -- date they collide (2023-05-01).
      ORDER BY branch_id, date_audit, client_bottle_audit_id
    `);

    /** "locationId|YYYY-MM-DD" -> { sessionId, branch } */
    const sessions = new Map<string, { id: string; branch: number }>();
    // NO per-(session, item) dedup, deliberately.
    //
    // Legacy records ONE row per physical measurement: a bottle with 42 sealed
    // units and 5 open ones is 1 FULL row (qty 42) plus 5 WEIGH rows, each with
    // its own scale reading. Deduplicating on (session, locationItem) collapsed
    // all of them into one line and silently discarded 3,446 real measurements —
    // almost every open-bottle content value in the migration.
    //
    // The rebuild expects exactly this shape: CountLine has no unique constraint
    // on (session, item), and report-assembly SUMS lines per item
    // (`agg.beginFullQty += line.qtyFull`). Idempotency comes from the LegacyMap
    // check on client_bottle_audit_id below, not from collapsing rows.

    let negativeContent = 0;
    let scaleBelowTare = 0;
    let contentWithoutDensity = 0;

    for (const a of rows) {
      const locationId = branchMap.get(String(a.branch_id));
      if (!locationId) {
        report.skip("branch-not-migrated", `audit ${a.client_bottle_audit_id} on branch ${a.branch_id}`);
        continue;
      }
      const countDate = (a.date_audit ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(countDate)) {
        report.skip("bad-audit-date", `audit ${a.client_bottle_audit_id} date_audit=${a.date_audit}`);
        continue;
      }

      let unitName: string | null;
      try {
        unitName = mapUom(a.bottle_uom);
      } catch (e) {
        throw new Error(`audit ${a.client_bottle_audit_id}: ${(e as Error).message}`);
      }
      if (unitName === null) {
        report.skip("unmappable-uom", `audit ${a.client_bottle_audit_id} uom "${a.bottle_uom}" — ${unmappableReason(a.bottle_uom)}`);
        continue;
      }

      const rawSize = Number(a.bottle_size ?? 0);
      const size = rawSize > 0 ? rawSize : 1;
      const variantId = variantMap.get(variantKey(a.bottle_id, size, unitName));
      if (!variantId) {
        report.skip("variant-missing", `audit ${a.client_bottle_audit_id}: bottle ${a.bottle_id} ${size}${unitName}`);
        continue;
      }

      const locationItem = await tx.locationItem.findUnique({
        where: { locationId_itemVariantId: { locationId, itemVariantId: variantId } },
        select: { id: true, retail: true, cost: true },
      });
      if (!locationItem) {
        report.skip(
          "item-not-in-location-catalog",
          `audit ${a.client_bottle_audit_id}: bottle ${a.bottle_id} ${size}${unitName} not stocked here`,
        );
        continue;
      }

      // ── The session ────────────────────────────────────────────────────
      //
      // Grouping by (location, date) is the only rule the data supports, and it
      // FIXES BY CONSTRUCTION the double-anchor defect found on 2026-08-22:
      // buildFullAudit selects counts by {locationId, countDate, status} and SUMS
      // every line, so two committed sessions on one date silently doubled an
      // item's beginning inventory.
      const sessionKey = `${locationId}|${countDate}`;
      let session = sessions.get(sessionKey);
      if (!session) {
        const existingId = await loadOrNull(tx, "count_session", sessionKey);
        const id =
          existingId ??
          (
            await tx.countSession.create({
              data: {
                locationId,
                countDate,
                name: "Migrated legacy count",
                status: "COMMITTED",
                createdById: adminId,
                createdByName: "Legacy migration",
                committedById: adminId,
                committedAt: new Date(`${countDate}T00:00:00.000Z`),
                note: `Synthesised from legacy client_bottle_audits (branch ${a.branch_id})`,
              },
              select: { id: true },
            })
          ).id;
        if (!existingId) {
          await record(tx, "count_session", sessionKey, id);
          report.count("CountSession (created)");
        }
        session = { id, branch: a.branch_id };
        sessions.set(sessionKey, session);
      }

      // The Mansion merge: branches 73 and 74 collide on exactly one date.
      // Merging both branches' lines into one session would sum two INDEPENDENT
      // counts into a single anchor — precisely the defect the grouping above
      // exists to avoid. Branch 73 wins; branch 74's lines for that date are
      // dropped and every one is listed.
      if (session.branch !== a.branch_id) {
        report.skip(
          "mansion-merge-duplicate-count",
          `audit ${a.client_bottle_audit_id} (branch ${a.branch_id}, ${countDate}) — branch ${session.branch}'s session kept`,
        );
        continue;
      }

      if (await loadOrNull(tx, "client_bottle_audits", a.client_bottle_audit_id)) {
        report.count("CountLine (matched existing)");
        continue;
      }

      // ── The line ───────────────────────────────────────────────────────
      const isWeigh = Number(a.audit_type) === 2;
      const scale = Number(a.scale_weight ?? 0);
      const tare = Number(a.tare_weight ?? 0);
      const density = Number(a.liquid_weight ?? 0);
      const content = Number(a.remaining_ml ?? 0);

      if (isWeigh) {
        if (content < 0) negativeContent += 1;
        if (scale < tare) scaleBelowTare += 1;
        if (density <= 0 && content > 0) contentWithoutDensity += 1;
      }

      const created = await tx.countLine.create({
        data: {
          countSessionId: session.id,
          locationItemId: locationItem.id,
          countType: isWeigh ? "WEIGH" : "FULL",
          qtyFull: isWeigh ? 0 : Number(a.qty ?? 0),
          // OUNCES, deliberately NOT converted — unlike the catalog. A count line
          // carries its own scale/tare/density snapshot, so it is self-describing
          // whatever scale it uses, and the arithmetic is unit-agnostic:
          // (s.k - t.k) x (d/k) = (s - t) x d. seed.ts:1472-1484 does exactly this
          // for the golden fixtures and says why. Converting would add rounding
          // drift to historical figures the client holds paper copies of.
          scaleWeight: isWeigh ? scale : null,
          scaleUnit: isWeigh ? "oz" : null,
          tareWeight: isWeigh ? tare : null,
          densityFactor: isWeigh && density > 0 ? density : null,
          // CARRIED, never recomputed. 1,397 weigh rows have no density at all
          // and 1,392 of those still hold content (up to 30,000 ml) — recomputing
          // (scale - tare) x density would zero every one of them. Legacy's stored
          // number is what its reports showed, and reproducing those reports is
          // the entire point.
          remainingContent: content,
          // Snapshot FROM THE SOURCE ROW. Reading cost from today's LocationItem
          // would restate three years of valuation at current prices — a
          // difference no error reports and nobody notices until a historical
          // report disagrees with the paper copy. LocationItem.cost is a fallback
          // only when legacy recorded none.
          unitCost: a.default_cost != null ? Number(a.default_cost) : locationItem.cost,
          // Legacy audits carry no retail; legacy's own report joined
          // client_bottles for it, which is exactly what LocationItem.retail now
          // holds (imported from default_retail). So this reproduces legacy.
          unitRetail: locationItem.retail,
          status: Number(a.is_deleted) === 1 ? "VOID" : "ACTIVE",
          createdById: adminId,
          createdByName: "Legacy migration",
        },
        select: { id: true },
      });
      await record(tx, "client_bottle_audits", a.client_bottle_audit_id, created.id);
      report.count(isWeigh ? "CountLine WEIGH" : "CountLine FULL");
      if (Number(a.is_deleted) === 1) report.count("CountLine (VOID, was is_deleted)");
    }

    // ── The invariant this stage exists to protect ─────────────────────────
    const dupes = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM (
         SELECT locationId, countDate FROM CountSession WHERE status = 'COMMITTED'
         GROUP BY locationId, countDate HAVING COUNT(*) > 1)`,
    );
    const dupCount = Number(dupes[0]?.n ?? 0);
    if (dupCount > 0) {
      throw new Error(
        `${dupCount} location/date pair(s) have TWO committed count sessions. buildFullAudit sums ` +
          `every line it finds, so this doubles beginning inventory. Refusing to leave the database ` +
          `in that state.`,
      );
    }

    // Sparse sessions are the single biggest threat to a believable Full Audit.
    // Legacy allows an aborted or partial count — one bottle out of a 313-item
    // catalog — and the rebuild treats EVERY committed session as an anchor. A
    // 1-line session anchors a period at nearly zero and reports the entire
    // shelf as variance. Imported as COMMITTED because that is what legacy holds
    // and reclassifying a client's audit history is not the importer's call, but
    // named here so a human can void them through the app.
    const sparse = await tx.$queryRawUnsafe<Array<{ loc: string; d: string; lines: bigint; catalog: bigint }>>(
      `SELECT l.name AS loc, cs.countDate AS d, COUNT(cl.id) AS lines,
              (SELECT COUNT(*) FROM LocationItem li WHERE li.locationId = cs.locationId) AS catalog
         FROM CountSession cs
         JOIN Location l ON l.id = cs.locationId
         LEFT JOIN CountLine cl ON cl.countSessionId = cs.id
        WHERE cs.status = 'COMMITTED'
        GROUP BY cs.id
       HAVING catalog > 0 AND lines * 10 < catalog`,
    );
    if (sparse.length > 0) {
      report.flag(
        `${sparse.length} committed session(s) cover LESS THAN 10% of their location's catalog and ` +
          `cannot serve as a meaningful audit anchor — a period bounded by one of these reports the ` +
          `whole shelf as variance. Void them in the app (void + correctionOfId) so they stop ` +
          `anchoring reports: ` +
          sparse.map((r) => `${r.loc} ${r.d} (${Number(r.lines)}/${Number(r.catalog)})`).join(", "),
      );
    }

    if (negativeContent > 0) {
      report.flag(
        `${negativeContent} weigh line(s) carry NEGATIVE remaining content, because legacy recorded ` +
          `a scale reading below the tare weight. Imported verbatim so historical reports still match ` +
          `the paper copies — but negative content SUBTRACTS from ending inventory, inflating usage ` +
          `and variance for those items. Void and correct them in the app (the correctionOfId trail ` +
          `exists for exactly this) rather than editing rows.`,
      );
    }
    if (scaleBelowTare > 0) {
      report.flag(
        `${scaleBelowTare} weigh line(s) have scaleWeight < tareWeight — a bottle lighter than empty. ` +
          `validateWeigh() treats this as BLOCKING for new entries, so these could not be typed in ` +
          `today. They are historical fact and are imported as-is.`,
      );
    }
    if (contentWithoutDensity > 0) {
      report.flag(
        `${contentWithoutDensity} weigh line(s) hold content but have NO density factor, so their ` +
          `content cannot be re-derived from scale and tare. The stored value is carried, which is ` +
          `what legacy reported. A recount is the only way to put these on a computable footing.`,
      );
    }
  },
};

async function loadOrNull(tx: Parameters<Stage["run"]>[0], table: string, legacyId: string | number) {
  const row = await tx.legacyMap.findUnique({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
    select: { newId: true },
  });
  return row?.newId ?? null;
}
