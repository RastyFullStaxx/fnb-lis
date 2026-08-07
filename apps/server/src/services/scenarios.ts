import type { ReconReport } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { buildFullAudit, loadAuditInputs, type AuditInputs } from "./report-assembly";

/**
 * What-if scenarios (client request I, 2026-08-06 — "may options ba system na
 * in case ulitin yung Final audit reports revised lahat ng sales, purchase, at
 * non revenue... This is a case What If pag duda si Client sa unang mga
 * pinasok na data").
 *
 * The shape of the answer was already in the data model: counts are their own
 * documents, sales and deliveries are separate records, and the report
 * recomputes from whatever is currently valid. What was missing was a way to
 * ask the question WITHOUT touching the live records — and a fast path, since
 * doing it for real means voiding every entry in the period one at a time.
 *
 * A scenario keeps the committed beginning and ending counts and replaces the
 * movements in between. Nothing here writes to an inventory table.
 */

/**
 * What a scenario replaces, and what it leaves alone.
 *
 * REPLACED: sales, non-revenue, production, deliveries, returned bottles —
 * the entries the client named, all of which one establishment records on its
 * own authority.
 *
 * LEFT LIVE: the beginning and ending counts (the client's whole premise), the
 * catalog, valuation costs, and TRANSFERS. A transfer is bilateral: the other
 * location has its own record of the same movement, and a hypothetical on one
 * side only would produce a report that disagrees with a real one for reasons
 * nobody could see. If a transfer is wrong, it is wrong for real and gets
 * corrected for real.
 */
export const SCENARIO_KINDS = ["SALE", "NON_REVENUE", "PRODUCTION", "PURCHASE", "FORFEIT"] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export async function getOwnedScenario(locationId: string, scenarioId: string) {
  const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId } });
  if (!scenario || scenario.locationId !== locationId) throw new AppError(404, "Scenario not found");
  return scenario;
}

/**
 * Build the audit inputs for a scenario: live counts, hypothetical movements.
 *
 * The returned object is the same shape `loadAuditInputs` produces, so
 * `buildFullAudit` consumes it without knowing the difference — which is the
 * point of splitting them. Every formula, rounding rule and golden-fixture
 * guarantee applies unchanged.
 */
export async function scenarioInputs(scenario: {
  id: string;
  locationId: string;
  begin: string;
  end: string;
}): Promise<AuditInputs> {
  const [live, entries] = await Promise.all([
    loadAuditInputs(scenario.locationId, scenario.begin, scenario.end),
    prisma.scenarioEntry.findMany({ where: { scenarioId: scenario.id } }),
  ]);

  const purchaseLines = entries
    .filter((e) => e.kind === "PURCHASE")
    .map((e) => ({ locationItemId: e.locationItemId, qty: e.qty, lineTotal: e.qty * (e.unitCost ?? 0) }));

  const forfeits = entries
    .filter((e) => e.kind === "FORFEIT")
    .map((e) => ({ locationItemId: e.locationItemId, remainingContent: 0, qty: e.qty }));

  /**
   * Scenario sales are item-level only — never menu sales.
   *
   * A menu sale expands through a snapshotted recipe version, and a
   * hypothetical recipe is a different question from a hypothetical quantity.
   * `menuItemId`/`recipeVersion` are therefore null, which the aggregation
   * already handles: it takes the `locationItemId` branch.
   */
  const sales = entries
    .filter((e) => e.kind === "SALE" || e.kind === "NON_REVENUE" || e.kind === "PRODUCTION")
    .map((e) => ({
      locationItemId: e.locationItemId,
      menuItemId: null,
      recipeVersion: null,
      kind: e.kind,
      qty: e.qty,
      unitPrice: e.unitPrice ?? 0,
      contentOverride: null,
    })) as unknown as AuditInputs["sales"];

  return {
    // The client's premise: the counts stay exactly as they were committed.
    beginLines: live.beginLines,
    endLines: live.endLines,
    // Bilateral, so never hypothetical — see the note above.
    transferOutLines: live.transferOutLines,
    transferReceipts: live.transferReceipts,
    purchaseLines,
    forfeits,
    sales,
  };
}

export async function buildScenarioReport(
  scenario: { id: string; locationId: string; begin: string; end: string },
  productType: string | undefined,
  allowedProductTypes: readonly string[] | null | undefined,
  costBasis: Parameters<typeof buildFullAudit>[5],
): Promise<ReconReport> {
  return buildFullAudit(
    scenario.locationId,
    scenario.begin,
    scenario.end,
    productType,
    allowedProductTypes,
    costBasis,
    await scenarioInputs(scenario),
  );
}

/**
 * Copy the period's real movements into the scenario, so it can be EDITED
 * rather than retyped.
 *
 * Offered alongside starting empty, which is what the client literally
 * described. Both exist because they answer different doubts: "the whole day's
 * entry is suspect, start again" versus "one of these forty lines is wrong and
 * I want to find out which".
 */
export async function seedScenarioFromLive(scenarioId: string, locationId: string, begin: string, end: string): Promise<number> {
  const live = await loadAuditInputs(locationId, begin, end);
  const rows: Array<{
    scenarioId: string;
    kind: string;
    locationItemId: string;
    businessDate: string;
    qty: number;
    unitCost: number | null;
    unitPrice: number | null;
  }> = [];

  for (const s of live.sales) {
    // Menu sales are skipped for the same reason they are not creatable here:
    // a recipe expansion is not a quantity anyone can meaningfully edit in a
    // what-if. They stay in the live report and out of the scenario.
    if (!s.locationItemId) continue;
    rows.push({
      scenarioId,
      kind: s.kind,
      locationItemId: s.locationItemId,
      businessDate: s.saleDate,
      qty: s.qty,
      unitCost: null,
      unitPrice: s.unitPrice,
    });
  }
  const purchases = await prisma.purchaseLine.findMany({
    where: {
      status: "ACTIVE",
      purchase: { locationId, status: "COMMITTED", purchaseDate: { gte: begin, lt: end } },
    },
    select: { locationItemId: true, qty: true, unitCost: true, purchase: { select: { purchaseDate: true } } },
  });
  for (const p of purchases) {
    rows.push({
      scenarioId,
      kind: "PURCHASE",
      locationItemId: p.locationItemId,
      businessDate: p.purchase.purchaseDate,
      qty: p.qty,
      unitCost: p.unitCost,
      unitPrice: null,
    });
  }

  if (rows.length === 0) return 0;
  await prisma.scenarioEntry.createMany({ data: rows });
  return rows.length;
}
