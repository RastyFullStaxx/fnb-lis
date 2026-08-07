import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { allowedProductTypes, dateString, diffReports, id as idSchema, nonNegative, positive } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { logActivity } from "../services/activity";
import { buildFullAudit } from "../services/report-assembly";
import {
  SCENARIO_KINDS,
  buildScenarioReport,
  getOwnedScenario,
  seedScenarioFromLive,
} from "../services/scenarios";
import { isCostBasis, type CostBasis } from "@fnb/core";

/**
 * What-if scenarios (client request I, 2026-08-06).
 *
 * Read-only against real inventory by construction: every route here writes to
 * `Scenario` / `ScenarioEntry` and nothing else. There is deliberately no
 * "apply this scenario to the live records" endpoint — promoting a scenario
 * would mean voiding and rewriting dozens of committed rows in one action, and
 * that is a decision to take after someone has actually used the read-only
 * version, not before.
 */

const guard = requirePermission("entries.create");

const scenarioCreate = z.object({
  begin: dateString,
  end: dateString,
  name: z.string().trim().min(1, "Give the scenario a name").max(120),
  note: z.string().trim().max(500).optional(),
  basedOnSnapshotId: idSchema.optional(),
  /** Start from the period's real movements instead of an empty sheet. */
  seedFromLive: z.boolean().optional(),
});

const entryCreate = z.object({
  kind: z.enum(SCENARIO_KINDS),
  locationItemId: idSchema,
  businessDate: dateString,
  qty: positive,
  unitCost: nonNegative.optional(),
  unitPrice: nonNegative.optional(),
  note: z.string().trim().max(300).optional(),
});

function basisOf(c: { get: (k: "client") => unknown }): CostBasis {
  const raw = (c.get("client") as { costBasis?: string } | undefined)?.costBasis;
  return isCostBasis(raw) ? raw : "PRICE";
}

export const scenarioRoutes = new Hono<AppEnv>()
  .get("/scenarios", async (c) => {
    const location = c.get("location");
    const scenarios = await prisma.scenario.findMany({
      where: { locationId: location.id, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { entries: true } } },
    });
    return c.json({ scenarios });
  })

  .post("/scenarios", guard, zValidator("json", scenarioCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    if (body.end <= body.begin) throw new AppError(400, "The ending count date must be after the beginning date");

    // The anchors have to be real committed counts, or the scenario answers a
    // question about a period that never closed. Same rule the report itself
    // applies, checked here so the failure lands at creation rather than as an
    // empty report later.
    const anchors = await prisma.countSession.findMany({
      where: { locationId: location.id, status: "COMMITTED", countDate: { in: [body.begin, body.end] } },
      select: { countDate: true },
      distinct: ["countDate"],
    });
    if (anchors.length < 2) {
      throw new AppError(400, "Both dates need a committed count — a scenario keeps the real beginning and ending inventory");
    }

    const scenario = await prisma.$transaction(async (tx) => {
      const created = await tx.scenario.create({
        data: {
          locationId: location.id,
          begin: body.begin,
          end: body.end,
          name: body.name,
          note: body.note || null,
          basedOnSnapshotId: body.basedOnSnapshotId || null,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "scenario.create",
          entity: "Scenario",
          entityId: created.id,
          summary: `Started the what-if "${body.name}" for ${body.begin} → ${body.end}`,
          details: { begin: body.begin, end: body.end, seeded: Boolean(body.seedFromLive) },
        },
        tx,
      );
      return created;
    });

    const seeded = body.seedFromLive
      ? await seedScenarioFromLive(scenario.id, location.id, body.begin, body.end)
      : 0;

    return c.json({ ...scenario, seededEntries: seeded }, 201);
  })

  .get("/scenarios/:id", async (c) => {
    const location = c.get("location");
    const scenario = await getOwnedScenario(location.id, c.req.param("id"));
    const entries = await prisma.scenarioEntry.findMany({
      where: { scenarioId: scenario.id },
      orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
      include: {
        // Names come from the live catalog — a scenario changes movements, not
        // what things are called.
      },
    });
    const items = await prisma.locationItem.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.locationItemId))] } },
      include: { itemVariant: { include: { unit: true, item: true } } },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    return c.json({
      scenario,
      entries: entries.map((e) => ({
        ...e,
        itemName: (() => {
          const li = byId.get(e.locationItemId);
          return li ? `${li.itemVariant.item.name} ${li.itemVariant.size} ${li.itemVariant.unit.name}` : "Unknown item";
        })(),
      })),
    });
  })

  /** The scenario's own Full Audit — same math, different movements. */
  .get("/scenarios/:id/report", async (c) => {
    const location = c.get("location");
    const scenario = await getOwnedScenario(location.id, c.req.param("id"));
    const report = await buildScenarioReport(
      scenario,
      c.req.query("productType") || undefined,
      allowedProductTypes(c.get("locationModules")),
      basisOf(c),
    );
    return c.json({ scenario, report });
  })

  /**
   * The scenario against the real report — "what would change if I were right".
   *
   * Reuses Phase 1's `diffReports` exactly as the version compare does: same
   * function, same epsilon, same ordering, so a scenario difference and a
   * revision difference read identically. The only thing that differs is which
   * two reports are handed in.
   */
  .get("/scenarios/:id/compare", async (c) => {
    const location = c.get("location");
    const scenario = await getOwnedScenario(location.id, c.req.param("id"));
    const productType = c.req.query("productType") || undefined;
    const allowed = allowedProductTypes(c.get("locationModules"));
    const [live, hypothetical] = await Promise.all([
      buildFullAudit(scenario.locationId, scenario.begin, scenario.end, productType, allowed, basisOf(c)),
      buildScenarioReport(scenario, productType, allowed, basisOf(c)),
    ]);
    // Live first: the delta then reads "what the what-if would do TO the real
    // figures", which is the direction the question is asked in.
    return c.json({ scenario, diff: diffReports(live, hypothetical) });
  })

  .post("/scenarios/:id/entries", guard, zValidator("json", entryCreate), async (c) => {
    const location = c.get("location");
    const scenario = await getOwnedScenario(location.id, c.req.param("id"));
    const body = c.req.valid("json");

    // The item must be in THIS location's catalog — same scoping rule every
    // other entry route follows, and the reason two cross-establishment leaks
    // were found earlier in this build.
    const item = await prisma.locationItem.findFirst({
      where: { id: body.locationItemId, locationId: location.id },
      select: { id: true },
    });
    if (!item) throw new AppError(404, "That item is not in this location's catalog");

    const entry = await prisma.scenarioEntry.create({
      data: {
        scenarioId: scenario.id,
        kind: body.kind,
        locationItemId: body.locationItemId,
        businessDate: body.businessDate,
        qty: body.qty,
        unitCost: body.unitCost ?? null,
        unitPrice: body.unitPrice ?? null,
        note: body.note || null,
      },
    });
    return c.json(entry, 201);
  })

  /**
   * A hard delete, unlike every other entry in this system.
   *
   * Immutability exists so an audited figure can never quietly change. A
   * scenario entry has never been part of an audited figure — it is a
   * hypothesis someone is still writing. Keeping voided hypotheses would add
   * an audit trail to a scratchpad.
   */
  .delete("/scenarios/:id/entries/:entryId", guard, async (c) => {
    const location = c.get("location");
    const scenario = await getOwnedScenario(location.id, c.req.param("id"));
    const { count } = await prisma.scenarioEntry.deleteMany({
      where: { id: c.req.param("entryId"), scenarioId: scenario.id },
    });
    if (count === 0) throw new AppError(404, "Entry not found");
    return c.json({ ok: true });
  })

  .post("/scenarios/:id/discard", guard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const scenario = await getOwnedScenario(location.id, c.req.param("id"));
    const discarded = await prisma.$transaction(async (tx) => {
      const updated = await tx.scenario.update({
        where: { id: scenario.id },
        data: { status: "DISCARDED" },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "scenario.discard",
          entity: "Scenario",
          entityId: scenario.id,
          summary: `Discarded the what-if "${scenario.name}"`,
        },
        tx,
      );
      return updated;
    });
    return c.json(discarded);
  });
