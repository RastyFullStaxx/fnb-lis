/**
 * Stocky's tool registry — the assistant's ENTIRE reach into the system.
 *
 * READ-ONLY INVARIANT (Phase 8 gate): this file must never import the Prisma
 * client (../db) or any service that mutates state. Its imports are limited to
 * the pure report services below and @fnb/core matching helpers, so a code
 * review of this import block alone proves Stocky cannot write anything.
 * The route injects locationId/clientId from the authenticated session —
 * tool inputs never carry tenant identifiers.
 */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { FUZZY_THRESHOLD, fuzzyScore, normalizeAlias, round2 } from "@fnb/core";
import { buildFullAudit, committedCountDates } from "./report-assembly";
import { fullAuditDrill, nonRevenueReport, onHandReport, purchaseReport, salesReport } from "./report-lists";
import { buildDashboard } from "./dashboard";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateStr = z.string().regex(DATE_RE, "must be YYYY-MM-DD");

export interface StockyContext {
  locationId: string;
  clientId: string;
}

export interface StockyTool {
  definition: Anthropic.Tool;
  /** Short human label for the UI status chip while the tool runs. */
  label: string;
  execute(ctx: StockyContext, input: unknown): Promise<unknown>;
}

/**
 * Query→name relevance in [0,1]. Substring containment beats pure edit
 * distance ("absolut" should hit "Absolut Vodka 700 ml"); token overlap
 * covers word reorderings and small typos; fuzzyScore is the floor.
 */
function matchScore(query: string, name: string): number {
  const q = normalizeAlias(query);
  const n = normalizeAlias(name);
  if (!q || !n) return 0;
  if (n === q) return 1;
  if (n.includes(q)) return 0.9 + 0.1 * (q.length / n.length);
  const qTokens = q.split(" ");
  const nTokens = n.split(" ");
  const hits = qTokens.filter((t) => nTokens.some((w) => w.startsWith(t) || fuzzyScore(t, w) >= 0.8)).length;
  return Math.max((hits / qTokens.length) * 0.85, fuzzyScore(q, n));
}

function rankByQuery<T>(rows: T[], query: string, nameOf: (row: T) => string): T[] {
  return rows
    .map((row) => ({ row, score: matchScore(query, nameOf(row)) }))
    .filter((x) => x.score >= FUZZY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.row);
}

/** Closest names for a "no match" reply so the model can offer options. */
function candidates(rows: string[], query: string): string[] {
  return [...new Set(rows)]
    .map((name) => ({ name, score: matchScore(query, name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.name);
}

const r2 = (v: number) => round2(v);

interface ZodToolSpec<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  label: string;
  schema: S;
  inputSchema: Anthropic.Tool.InputSchema;
  run(ctx: StockyContext, input: z.infer<S>): Promise<unknown>;
}

function tool<S extends z.ZodTypeAny>(spec: ZodToolSpec<S>): StockyTool {
  return {
    label: spec.label,
    definition: { name: spec.name, description: spec.description, input_schema: spec.inputSchema },
    async execute(ctx, input) {
      const parsed = spec.schema.safeParse(input ?? {});
      if (!parsed.success) {
        return { error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
      }
      return spec.run(ctx, parsed.data);
    },
  };
}

// ── get_stock ──

const getStock = tool({
  name: "get_stock",
  label: "Checking stock on hand",
  description:
    "Current stock on hand per item (computed from the last committed count plus activity since), with cost/retail valuation and below-par flags. Filter by item name, category, or belowParOnly. No filters returns the biggest positions by value plus totals.",
  schema: z.object({
    itemQuery: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    belowParOnly: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      itemQuery: { type: "string", description: "Item name to look up, e.g. 'Absolut' or 'San Miguel'" },
      category: { type: "string", description: "Restrict to a category name, e.g. 'Vodka'" },
      belowParOnly: { type: "boolean", description: "Only items below their par level" },
    },
    required: [],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const report = await onHandReport(ctx.locationId);
    if (!report.lastCountDate) {
      return { error: "No committed counts yet — stock on hand is unknown until the first count is committed." };
    }
    let rows = report.rows;
    if (input.category) {
      const cat = normalizeAlias(input.category);
      rows = rows.filter((r) => normalizeAlias(r.category).includes(cat));
    }
    if (input.belowParOnly) rows = rows.filter((r) => r.belowPar);
    if (input.itemQuery) {
      const ranked = rankByQuery(rows, input.itemQuery, (r) => r.name);
      if (ranked.length === 0) {
        return { error: `No item matched "${input.itemQuery}"`, candidates: candidates(report.rows.map((r) => r.name), input.itemQuery) };
      }
      rows = ranked;
    } else {
      rows = [...rows].sort((a, b) => b.costValue - a.costValue);
    }
    const capped = rows.slice(0, 20);
    return {
      lastCountDate: report.lastCountDate,
      note: "onHand = last committed count + committed activity since",
      rows: capped.map((row) => ({
        name: row.name,
        category: row.category,
        onHand: r2(row.onHand),
        unitCost: r2(row.cost),
        unitRetail: r2(row.retail),
        costValue: r2(row.costValue),
        retailValue: r2(row.retailValue),
        belowPar: row.belowPar,
      })),
      totals: { costValue: r2(report.totals.costValue), retailValue: r2(report.totals.retailValue) },
      link: `/l/${ctx.locationId}/reports/on-hand`,
      ...(rows.length > capped.length ? { truncated: true, totalRows: rows.length } : {}),
    };
  },
});

// ── Full Audit row serialization shared by get_report_row / explain_variance ──

type ReconRowLike = Awaited<ReturnType<typeof buildFullAudit>>["rows"][number];

function serializeRow(row: ReconRowLike) {
  return {
    itemName: row.itemName,
    category: row.categoryName,
    begin: { full: r2(row.beginFull), openEquiv: r2(row.beginOpenEquiv) },
    purchased: r2(row.purchased),
    returnedForfeits: r2(row.forfeited),
    end: { full: r2(row.endFull), openEquiv: r2(row.endOpenEquiv) },
    usage: r2(row.usage),
    soldDirect: r2(row.soldDirect),
    soldViaRecipes: r2(row.soldPortion),
    nonRevenue: r2(row.nonRevenue),
    production: r2(row.production),
    revenue: r2(row.revenue),
    variance: r2(row.variance),
    variancePct: row.variancePct === null ? null : r2(row.variancePct),
    varianceCost: r2(row.varianceCost),
    varianceRetail: r2(row.varianceRetail),
    short: row.flags.short,
    missingPrice: row.flags.missingPrice,
  };
}

async function auditWithDates(ctx: StockyContext, begin: string, end: string) {
  const dates = await committedCountDates(ctx.locationId);
  if (!dates.includes(begin) || !dates.includes(end)) {
    return { error: `begin and end must both be committed count dates. Available: ${dates.join(", ") || "(none)"}` };
  }
  if (end <= begin) return { error: "end must be after begin" };
  return { report: await buildFullAudit(ctx.locationId, begin, end) };
}

// ── get_report_row ──

const getReportRow = tool({
  name: "get_report_row",
  label: "Reading the Full Audit",
  description:
    "The Full Audit reconciliation row(s) for an item over an audit period. begin/end must be committed count dates (listed in the system prompt). Returns begin/end counts, purchases, returns, usage, sold, non-revenue, production, revenue and the variance figures.",
  schema: z.object({ begin: dateStr, end: dateStr, itemQuery: z.string().min(1) }),
  inputSchema: {
    type: "object",
    properties: {
      begin: { type: "string", description: "Beginning count date, YYYY-MM-DD" },
      end: { type: "string", description: "Ending count date, YYYY-MM-DD" },
      itemQuery: { type: "string", description: "Item name to look up" },
    },
    required: ["begin", "end", "itemQuery"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const res = await auditWithDates(ctx, input.begin, input.end);
    if ("error" in res) return res;
    const ranked = rankByQuery(res.report.rows, input.itemQuery, (r) => r.itemName);
    if (ranked.length === 0) {
      return { error: `No audit row matched "${input.itemQuery}"`, candidates: candidates(res.report.rows.map((r) => r.itemName), input.itemQuery) };
    }
    return {
      period: { begin: input.begin, end: input.end, note: "activity counted in [begin, end) — up to, not including, the ending count date" },
      rows: ranked.slice(0, 5).map(serializeRow),
      grandTotals: {
        revenue: r2(res.report.totals.revenue),
        varianceCost: r2(res.report.totals.varianceCost),
        varianceRetail: r2(res.report.totals.varianceRetail),
      },
      link: `/l/${ctx.locationId}/reports/full-audit?begin=${input.begin}&end=${input.end}`,
    };
  },
});

// ── explain_variance ──

const explainVariance = tool({
  name: "explain_variance",
  label: "Tracing the source records",
  description:
    "Deep-dive one item's variance for an audit period: the reconciliation row PLUS every source record behind it (counts, purchases, sales, non-revenue, production, returns). Use this to answer WHY an item is short or over.",
  schema: z.object({ begin: dateStr, end: dateStr, itemQuery: z.string().min(1) }),
  inputSchema: {
    type: "object",
    properties: {
      begin: { type: "string", description: "Beginning count date, YYYY-MM-DD" },
      end: { type: "string", description: "Ending count date, YYYY-MM-DD" },
      itemQuery: { type: "string", description: "Item name to explain" },
    },
    required: ["begin", "end", "itemQuery"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const res = await auditWithDates(ctx, input.begin, input.end);
    if ("error" in res) return res;
    const ranked = rankByQuery(res.report.rows, input.itemQuery, (r) => r.itemName);
    const best = ranked[0];
    if (!best) {
      return { error: `No audit row matched "${input.itemQuery}"`, candidates: candidates(res.report.rows.map((r) => r.itemName), input.itemQuery) };
    }
    const drill = await fullAuditDrill(ctx.locationId, best.locationItemId, input.begin, input.end);
    const capped = drill.slice(0, 40);
    // Inclusive end for the list-report links (their ranges are [from, to]).
    return {
      row: serializeRow(best),
      formula: "variance = (soldDirect + soldViaRecipes + nonRevenue + production) − usage; usage = begin + purchased + returns − end",
      sourceRecords: capped.map((d) => ({ kind: d.kind, date: d.date, detail: d.detail, qty: d.qty === null ? null : r2(d.qty), amount: d.amount === null ? null : r2(d.amount) })),
      links: {
        fullAudit: `/l/${ctx.locationId}/reports/full-audit?begin=${input.begin}&end=${input.end}`,
        sales: `/l/${ctx.locationId}/reports/sales?from=${input.begin}&to=${input.end}`,
        purchases: `/l/${ctx.locationId}/reports/purchases?from=${input.begin}&to=${input.end}`,
      },
      ...(drill.length > capped.length ? { truncated: true, totalRecords: drill.length } : {}),
    };
  },
});

// ── find_records ──

const findRecords = tool({
  name: "find_records",
  label: "Searching the records",
  description:
    "List sales, purchases, or non-revenue records in an INCLUSIVE [from, to] date range, optionally filtered by item/supplier/reason text. Purchases include a by-supplier rollup; non-revenue a by-reason rollup.",
  schema: z.object({
    kind: z.enum(["sales", "purchases", "non_revenue"]),
    from: dateStr,
    to: dateStr,
    query: z.string().min(1).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["sales", "purchases", "non_revenue"], description: "Record type to search" },
      from: { type: "string", description: "Start date (inclusive), YYYY-MM-DD" },
      to: { type: "string", description: "End date (inclusive), YYYY-MM-DD" },
      query: { type: "string", description: "Filter by item, supplier, or reason text" },
    },
    required: ["kind", "from", "to"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    if (input.to < input.from) return { error: "to must be on or after from" };
    if (input.kind === "sales") {
      const rep = await salesReport(ctx.locationId, input.from, input.to);
      let rows = rep.rows;
      if (input.query) rows = rankByQuery(rows, input.query, (r) => r.name);
      const capped = rows.slice(0, 25);
      return {
        rows: capped.map((row) => ({ date: row.saleDate, name: row.name, kind: row.kind, qty: r2(row.qty), unitPrice: r2(row.unitPrice), discountPct: r2(row.discountPct), net: r2(row.net) })),
        totals: { qty: r2(rep.totals.qty), gross: r2(rep.totals.gross), net: r2(rep.totals.net) },
        link: `/l/${ctx.locationId}/reports/sales?from=${input.from}&to=${input.to}`,
        ...(rows.length > capped.length ? { truncated: true, totalRows: rows.length } : {}),
      };
    }
    if (input.kind === "purchases") {
      const rep = await purchaseReport(ctx.locationId, input.from, input.to);
      let rows = rep.rows;
      if (input.query) {
        const byItem = rankByQuery(rows, input.query, (r) => r.name);
        const bySupplier = rankByQuery(rows, input.query, (r) => r.supplier);
        rows = byItem.length >= bySupplier.length ? byItem : bySupplier;
      }
      const capped = rows.slice(0, 25);
      return {
        rows: capped.map((row) => ({ date: row.purchaseDate, supplier: row.supplier, refNo: row.refNo, name: row.name, qty: r2(row.qty), unitCost: r2(row.unitCost), lineTotal: r2(row.lineTotal) })),
        bySupplier: rep.bySupplier.slice(0, 10).map((s) => ({ supplier: s.supplier, qty: r2(s.qty), cost: r2(s.cost) })),
        totals: { qty: r2(rep.totals.qty), cost: r2(rep.totals.cost) },
        link: `/l/${ctx.locationId}/reports/purchases?from=${input.from}&to=${input.to}`,
        ...(rows.length > capped.length ? { truncated: true, totalRows: rows.length } : {}),
      };
    }
    const rep = await nonRevenueReport(ctx.locationId, input.from, input.to);
    let rows = rep.rows;
    if (input.query) {
      const byItem = rankByQuery(rows, input.query, (r) => r.name);
      const byReason = rankByQuery(rows, input.query, (r) => r.reason);
      rows = byItem.length >= byReason.length ? byItem : byReason;
    }
    const capped = rows.slice(0, 25);
    return {
      rows: capped.map((row) => ({ date: row.saleDate, name: row.name, reason: row.reason, qty: r2(row.qty), contentOverride: row.contentOverride, estimatedCost: row.estimatedCost === null ? null : r2(row.estimatedCost) })),
      byReason: rep.byReason.slice(0, 10).map((x) => ({ reason: x.reason, count: x.count, qty: r2(x.qty), cost: r2(x.cost) })),
      totals: { count: rep.totals.count, qty: r2(rep.totals.qty), cost: r2(rep.totals.cost) },
      link: `/l/${ctx.locationId}/reports/non-revenue?from=${input.from}&to=${input.to}`,
      ...(rows.length > capped.length ? { truncated: true, totalRows: rows.length } : {}),
    };
  },
});

// ── get_dashboard ──

const getDashboard = tool({
  name: "get_dashboard",
  label: "Checking the dashboard",
  description:
    "Location overview: audit-period status (last count date, whether a Full Audit is possible, the latest closable period), attention items (missing prices, pending import rows, draft purchases, open counts) and the top variance leaders of the latest period.",
  schema: z.object({}),
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  async run(ctx) {
    const dash = await buildDashboard(ctx.locationId, ctx.clientId);
    return {
      period: dash.period,
      attention: dash.attention,
      varianceLeaders: dash.varianceLeaders.slice(0, 5).map((l) => ({
        itemName: l.itemName,
        variancePct: l.variancePct === null ? null : r2(l.variancePct),
        varianceCost: r2(l.varianceCost),
        short: l.short,
      })),
      recentActivity: dash.recentActivity.slice(0, 5).map((a) => ({ when: a.ts, who: a.userName, what: a.summary })),
      link: `/l/${ctx.locationId}/dashboard`,
    };
  },
});

// ── explain_formula ──
// Prose transcribed from docs/architecture.md §6 (the verified legacy math).
// Deterministic text — no DB, no model.

const FORMULA_EXPLANATIONS: Record<string, { formula: string; explanation: string }> = {
  usage: {
    formula: "usage = (beginFull + beginOpenEquiv) + purchased + returns − (endFull + endOpenEquiv)",
    explanation:
      "Usage is what physically left the shelf between two counts: start with the beginning count (full units plus open-bottle equivalents), add purchases received and returned partial bottles (forfeits add BACK into the pool), then subtract the ending count. Activity is counted in the half-open window [begin, end) — up to, not including, the ending count date.",
  },
  variance: {
    formula: "variance = (soldDirect + soldViaRecipes + nonRevenue + production) − usage",
    explanation:
      "Variance compares what the records say was consumed (direct sales, recipe portions from menu sales, non-revenue like spillage or comps, and production) against the physical usage between counts. Negative variance = shortage: more left the shelf than the records explain. Positive = overage.",
  },
  variance_pct: {
    formula: "variancePct = usage > 0 ? variance / usage × 100 : null",
    explanation: "The variance expressed as a percentage of usage; undefined when the period had no usage. Cost and retail impact are variance × cost basis and variance × retail price.",
  },
  open_equiv: {
    formula: "openEquiv = contentTracked ? remainingContent / size : rawValue",
    explanation:
      "Open partial bottles are converted to fractions of a full unit by dividing the remaining content by the variant size (a 700 ml bottle with 350 ml left counts as 0.5). Items that aren't content-tracked count at face value.",
  },
  weigh: {
    formula: "remaining = phpRound((scaleWeight − tareWeight) × densityFactor)",
    explanation:
      "Weigh counts turn a scale reading into remaining content: subtract the empty-bottle tare weight, multiply by the density factor (ml per weight unit — per-item override, else the category default, e.g. Vodka 30.12 on the oz scale), and round half-away-from-zero to whole ml. A reading below the tare is blocked; content above the bottle size warns.",
  },
  recipe_expansion: {
    formula: "consumption per ingredient = contentTracked ? (serving / size) × qtySold : serving × qtySold",
    explanation:
      "Each menu sale consumes its recipe's ingredients: a 45 ml serving from a 700 ml bottle consumes 45/700 of a bottle per drink sold. Non-content items consume the raw serving quantity. The recipe version is snapshotted at sale time, so later recipe edits never change history.",
  },
  menu_revenue: {
    formula: "share = ((serving / menuTotalServing) × SRP) × qty − ((SRP × disc% / 100) / ingredientCount) × qty",
    explanation:
      "A menu item's revenue is split across its ingredients in proportion to their share of the recipe's total serving volume (legacy 'mtotal'), and any discount is deducted in equal parts per ingredient line. This reproduces the legacy report exactly.",
  },
  cost_basis: {
    formula: "costBasis = endCount snapshot cost → else beginCount snapshot cost → else current cost",
    explanation:
      "Variance cost uses the unit cost snapshotted on the ending count when present, falling back to the beginning count's snapshot, then to the current catalog cost. Snapshots keep historical reports stable when prices change later.",
  },
  date_semantics: {
    formula: "counts ON boundary dates; audit activity in [begin, end); list reports inclusive [from, to]",
    explanation:
      "Counts are read on the beginning and ending dates themselves (committed sessions only). Audit-period activity — purchases, sales, forfeits — is summed from the beginning date up to but NOT including the ending date, so back-to-back periods never double-count a day. The sales/purchases/non-revenue list reports use ordinary inclusive ranges. 'This period' means the two most recent committed count dates.",
  },
};

const explainFormula = tool({
  name: "explain_formula",
  label: "Looking up the formula",
  description:
    "The exact reconciliation formulas this system uses (verified against the legacy system). Use for questions like 'how is usage calculated?' or 'how does weighing work?'.",
  schema: z.object({
    name: z.enum(["usage", "variance", "variance_pct", "open_equiv", "weigh", "recipe_expansion", "menu_revenue", "cost_basis", "date_semantics"]),
  }),
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: ["usage", "variance", "variance_pct", "open_equiv", "weigh", "recipe_expansion", "menu_revenue", "cost_basis", "date_semantics"],
        description: "Which formula to explain",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async run(_ctx, input) {
    return { name: input.name, ...FORMULA_EXPLANATIONS[input.name] };
  },
});

export const STOCKY_TOOLS: StockyTool[] = [getStock, getReportRow, explainVariance, findRecords, getDashboard, explainFormula];

export function stockyToolByName(name: string): StockyTool | undefined {
  return STOCKY_TOOLS.find((t) => t.definition.name === name);
}
