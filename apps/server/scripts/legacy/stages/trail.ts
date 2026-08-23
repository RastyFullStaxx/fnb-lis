/**
 * Stage 8 — the legacy activity trail.
 *
 * 21,991 rows of legacy `trail` become ActivityLog entries. Runs last: nothing
 * depends on it, and it is by far the largest write.
 *
 * WHY THESE ARE WRITTEN UNCHAINED, when the import stages' own entries are not.
 *
 * ActivityLog is hash-chained. The import stages log through `logActivity()`,
 * which links each entry into the chain, because those are mutations happening
 * NOW and must be tamper-evident from the moment they land.
 *
 * These rows are different: they are history from another system, and no hash
 * this migration computes could attest to what happened in 2023. The codebase
 * already has the honest mechanism for exactly this — entries written before
 * chaining shipped are reported by the verifier as `unchained` rather than
 * corrupt, and `npm run seal-history` seals them once. So they land unchained
 * and are sealed afterwards.
 *
 * Sealing does NOT prove they are authentic. It freezes them as they stand, so
 * from that point they cannot be edited undetected. `seal-history` appends them
 * AFTER the current chain tip rather than rewriting live hashes, which means
 * chain order will not match timestamp order. That is the script's documented
 * trade, not an accident.
 */
import type { Stage } from "../../import-legacy";
import { query, scalar } from "../source";
import { loadMap } from "../map";

type LegacyTrail = {
  trail_id: number;
  user_id: number;
  name: string;
  description: string;
  legacy_client_id: number | null;
  ts: string;
};

/** `Audit` -> `legacy.audit`, `Client Bottle` -> `legacy.clientBottle`. */
function actionSlug(name: string): string {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const [first, ...others] = parts;
  if (!first) return "legacy.unknown";
  const head = first.toLowerCase();
  const rest = others.map((p) => (p[0] ?? "").toUpperCase() + p.slice(1).toLowerCase());
  return `legacy.${[head, ...rest].join("")}`;
}

export const trailStage: Stage = {
  name: "trail",
  async run(tx, report) {
    // Coarse idempotency: this stage is one transaction, so it either lands
    // whole or not at all — a partial run is impossible and a per-row LegacyMap
    // would mean 21,991 extra rows to guard against something that cannot happen.
    const already = await tx.activityLog.count({ where: { entity: "legacy" } });
    if (already > 0) {
      report.count("ActivityLog (already imported, skipped)", already);
      report.flag(
        `${already} legacy trail entries are already present, so this stage did nothing. ` +
          `To re-import, delete them first — but note they may already be SEALED into the hash ` +
          `chain, in which case deleting them breaks it.`,
      );
      return;
    }

    const total = Number(scalar("SELECT COUNT(*) FROM trail"));

    // The client is embedded in the description as "Client: NN" — 19,804 of
    // 21,991 rows carry it. Extracting it is what makes these entries visible in
    // a client's Activity screen; without it they are 21,991 rows nobody can
    // find, which is the same defect the import stages had until today.
    const rows = query<LegacyTrail>(`
      SELECT JSON_OBJECT(
        'trail_id', trail_id,
        'user_id', user_id,
        'name', name,
        'description', description,
        'legacy_client_id', CAST(REGEXP_SUBSTR(description, '(?<=Client: )[0-9]+') AS UNSIGNED),
        'ts', DATE_FORMAT(date, '%Y-%m-%dT%H:%i:%s')
      ) FROM trail ORDER BY trail_id
    `);

    const clientMap = await loadMap(tx, "clients");
    const userMap = await loadMap(tx, "users");

    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(userMap.values())] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

    type Row = {
      ts: Date;
      userId: string | null;
      userName: string | null;
      clientId: string | null;
      action: string;
      entity: string;
      entityId: string;
      summary: string;
    };
    const batch: Row[] = [];
    let unattributed = 0;
    let unknownUser = 0;

    for (const r of rows) {
      const clientId = r.legacy_client_id != null ? (clientMap.get(String(r.legacy_client_id)) ?? null) : null;
      if (!clientId) unattributed += 1;

      const userId = userMap.get(String(r.user_id)) ?? null;
      if (!userId) unknownUser += 1;

      batch.push({
        ts: new Date(`${r.ts}Z`),
        userId,
        userName: userId ? (nameById.get(userId) ?? null) : `legacy user ${r.user_id}`,
        clientId,
        action: actionSlug(r.name),
        entity: "legacy",
        // The legacy primary key, so a row here can always be traced back.
        entityId: String(r.trail_id),
        summary: (r.description ?? "").trim() || `(legacy ${r.name})`,
      });
    }

    // createMany in chunks: 21,991 individual creates inside one transaction
    // would hold the SQLite write lock far longer than necessary.
    const CHUNK = 500;
    let written = 0;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK);
      // seq / prevHash / hash deliberately absent — see the file header.
      await tx.activityLog.createMany({ data: slice });
      written += slice.length;
    }
    report.count("ActivityLog (legacy, unchained)", written);

    if (written !== total) {
      report.flag(`Read ${total} legacy trail rows but wrote ${written}. They should match.`);
    }
    if (unattributed > 0) {
      report.flag(
        `${unattributed} trail entr${unattributed === 1 ? "y" : "ies"} could not be attributed to a ` +
          `migrated client (no "Client: NN" marker in the description, or the client was not ` +
          `migrated). They import with a null clientId, which means they appear only in a global ` +
          `activity view, not in any client's Activity screen.`,
      );
    }
    if (unknownUser > 0) {
      report.flag(
        `${unknownUser} trail entr${unknownUser === 1 ? "y" : "ies"} reference a legacy user_id with ` +
          `no migrated User. userId is null and the display name falls back to "legacy user <id>", ` +
          `so the entry is still readable but not linked to an account.`,
      );
    }

    report.flag(
      `These ${written} entries are UNCHAINED by design. Run \`npm run seal-history -w @fnb/server\` ` +
        `(dry run first, then -- --confirm) to seal them. Sealing freezes them as they stand; it does ` +
        `NOT attest that the legacy history is authentic, and it appends them after the current chain ` +
        `tip, so chain order will not match timestamp order.`,
    );
  },
};
