/**
 * Stocky's no-key brain: a deterministic, rule-based engine that answers from
 * the SAME read-only tools the LLM path uses (services/stocky-tools.ts). This
 * is what makes Stocky useful with no ANTHROPIC_API_KEY at all -- a key only
 * upgrades it to free-form conversation. Ported in spirit from the StockLedger
 * prototype's rule assistant: intent match -> evidence via tools -> plain
 * answer with real numbers and record links. READ-ONLY: it only calls the
 * tools and committed-count-date lookup; it never writes.
 */
import { normalizeAlias } from "@fnb/core";
import { committedCountDates } from "./report-assembly";
import { onHandReport, purchaseReport } from "./report-lists";
import { type StockyContext, stockyToolByName } from "./stocky-tools";

const PESO = "₱"; // ₱
const MINUS = "−"; // − (matches the report UI)
const MID = "·"; // ·
const peso = (n: number) => `${n < 0 ? "-" : ""}${PESO}${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
const UNIT_TOKENS = new Set(["ml", "g", "kg", "l", "oz", "cl", "pack", "packs", "bottle", "bottles", "can", "cans", "pcs", "pc"]);

/** A write request in this domain -- Stocky refuses and points to the screen. */
const WRITE_RE =
  /\b(delete|remove|void|cancel|edit|update|adjust|overwrite|correct|commit|approve|reject|rename|modify|change|set|create|reduce|increase|add)\b/;

async function callTool(ctx: StockyContext, name: string, input: unknown): Promise<Record<string, unknown>> {
  const tool = stockyToolByName(name)!;
  return (await tool.execute(ctx, input)) as Record<string, unknown>;
}

/** Distinctive tokens of a catalog name (drop sizes and unit words). */
function nameTokens(name: string): string[] {
  return normalizeAlias(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !UNIT_TOKENS.has(t) && !/^\d/.test(t));
}

/** The catalog/supplier name most clearly referenced in the message, if any. */
function mentionedName(message: string, names: string[]): string | null {
  const msg = normalizeAlias(message);
  let best: { name: string; hits: number } | null = null;
  for (const name of names) {
    const tokens = nameTokens(name);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(msg)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { name, hits };
  }
  return best?.name ?? null;
}

/** Resolve an audit period (two committed count dates) from the message. */
function resolvePeriod(message: string, dates: string[]): { begin: string; end: string } | null {
  if (dates.length < 2) return null;
  const explicit = message.match(DATE_RE);
  if (explicit && explicit.length >= 2) {
    const sorted = [explicit[0]!, explicit[1]!].sort();
    const a = sorted[0]!, b = sorted[1]!;
    if (dates.includes(a) && dates.includes(b)) return { begin: a, end: b };
  }
  if (/\b(last|previous|prior)\s+(period|audit|cycle)\b/.test(message) && dates.length >= 3) {
    return { begin: dates[dates.length - 3]!, end: dates[dates.length - 2]! };
  }
  return { begin: dates[dates.length - 2]!, end: dates[dates.length - 1]! };
}

/** Resolve an inclusive [from, to] range for record searches. Explicit dates
 *  win; otherwise default to the whole committed-count span (so "recently" /
 *  "last week" surface real data instead of an empty literal window). */
function resolveRange(message: string, dates: string[]): { from: string; to: string } {
  const explicit = message.match(DATE_RE);
  if (explicit && explicit.length >= 2) {
    const sorted = [explicit[0]!, explicit[1]!].sort();
    return { from: sorted[0]!, to: sorted[1]! };
  }
  if (dates.length >= 2) return { from: dates[0]!, to: dates[dates.length - 1]! };
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(today.getTime() - 30 * 864e5)), to: iso(today) };
}

const FORMULA_KEYWORDS: Array<[RegExp, string]> = [
  [/\bweigh|weight|scale|tare|density|remaining (content|bottle)|open bottle|bottle content\b/, "weigh"],
  [/\bvariance %|variance percent|percent(age)? short\b/, "variance_pct"],
  [/\busage\b/, "usage"],
  [/\bopen (bottle|equivalent|equiv|partial)|partial bottle\b/, "open_equiv"],
  [/\brecipe|ingredient|menu consumption|serving\b/, "recipe_expansion"],
  [/\bmenu revenue|revenue split|srp\b/, "menu_revenue"],
  [/\bcost basis|cost snapshot|which cost\b/, "cost_basis"],
  [/\bhalf-open|date semantics|activity window|which dates|period window\b/, "date_semantics"],
  [/\bvariance|discrepancy|shortage\b/, "variance"],
];

type Intent =
  | { kind: "write" }
  | { kind: "help" }
  | { kind: "formula"; name: string }
  | { kind: "variance"; explain: boolean }
  | { kind: "records"; recordKind: "sales" | "purchases" | "non_revenue" }
  | { kind: "stock"; belowParOnly: boolean }
  | { kind: "dashboard" };

function classify(message: string): Intent {
  const m = normalizeAlias(message);
  const isQuestion = /\b(how|what|why|which|when|show|list|tell|explain|is|are|do|does|did)\b/.test(m) || m.includes("?");
  const asksFormula = /\b(how (is|do|does|are)|calculate|formula|work(s|ed)?|computed|figured|derived)\b/.test(m);

  if (asksFormula) {
    for (const [re, name] of FORMULA_KEYWORDS) if (re.test(m)) return { kind: "formula", name };
  }

  // Write intent -- but only when it's clearly a command, not a read question.
  if (WRITE_RE.test(m) && !asksFormula && !/\bwhat (changed|happened)\b/.test(m)) {
    if (!(isQuestion && /\b(variance|stock|on hand|sold|bought|purchase|report|audit)\b/.test(m) && !/\b(delete|void|remove|cancel|set|change)\b/.test(m))) {
      return { kind: "write" };
    }
  }

  if (/\b(help|what can you|who are you|hi|hello|hey|start)\b/.test(m) && m.length < 40) return { kind: "help" };

  if (/\b(why|short|over|shortage|overage|variance|discrepancy|off by|missing)\b/.test(m)) {
    const explain = /\bwhy|explain|cause|reason|because|how come\b/.test(m);
    if (/\b(variance|short|over|why|discrepancy|reconcile)\b/.test(m)) return { kind: "variance", explain };
  }

  if (/\b(bought|buy|buying|purchase|purchased|received|supplier|invoice|delivery)\b/.test(m)) return { kind: "records", recordKind: "purchases" };
  if (/\b(non-?revenue|spillage|spill |spilled|comp(ed|limentary)?|waste|wasted|spoilage|breakage|tasting|staff use)\b/.test(m)) return { kind: "records", recordKind: "non_revenue" };
  if (/\b(sold|sale|sales|revenue|selling)\b/.test(m)) return { kind: "records", recordKind: "sales" };

  if (/\b(below par|low stock|running low|need(s)? reorder|restock)\b/.test(m)) return { kind: "stock", belowParOnly: true };
  if (/\b(stock|on hand|on-hand|inventory|how (many|much)|left|remaining|count of|valuation|worth)\b/.test(m)) return { kind: "stock", belowParOnly: false };

  if (/\b(dashboard|overview|status|summary|attention|what should|next|how are we|health|snapshot)\b/.test(m)) return { kind: "dashboard" };

  return { kind: "help" };
}

// ---- Composition ----

function screenLinks(locationId: string): string {
  return [
    `- record or fix counts -> [Counts](/l/${locationId}/counts)`,
    `- receive purchases -> [Purchases](/l/${locationId}/purchases)`,
    `- record sales, non-revenue, or production -> [Sales](/l/${locationId}/sales)`,
    `- edit prices and items -> [Items](/l/${locationId}/items)`,
  ].join("\n");
}

function helpText(locationName: string): string {
  return `I'm Stocky -- I explain your stock and the audit numbers from **${locationName}**'s live records. I'm read-only, so I can look things up but never change anything.

Try asking:
- Why is Absolut short this period?
- What did we buy from Metro Beverage?
- How is remaining bottle content calculated?
- What needs my attention?`;
}

function noMatch(result: Record<string, unknown>): string | null {
  if (typeof result.error !== "string") return null;
  const cands = Array.isArray(result.candidates) ? (result.candidates as string[]) : [];
  const suffix = cands.length ? `\n\nDid you mean:\n${cands.map((c) => `- ${c}`).join("\n")}` : "";
  return `${result.error}.${suffix}`;
}

interface ReconRowLite {
  itemName: string;
  begin: { full: number; openEquiv: number };
  end: { full: number; openEquiv: number };
  purchased: number;
  returnedForfeits: number;
  usage: number;
  soldDirect: number;
  soldViaRecipes: number;
  nonRevenue: number;
  production: number;
  variance: number;
  variancePct: number | null;
  varianceCost: number;
}

function varianceNarrative(row: ReconRowLite, period: { begin: string; end: string }, link: string, records?: Array<Record<string, unknown>>): string {
  const dir = row.variance < 0 ? "short" : row.variance > 0 ? "over" : "reconciled";
  const pct = row.variancePct === null ? null : `${qty(Math.abs(row.variancePct))}%`;
  const beginTot = row.begin.full + row.begin.openEquiv;
  const endTot = row.end.full + row.end.openEquiv;
  const expected = row.soldDirect + row.soldViaRecipes + row.nonRevenue + row.production;

  if (dir === "reconciled") {
    return `**${row.itemName}** reconciled cleanly for ${period.begin} to ${period.end} -- no variance. Usage was **${qty(row.usage)}** and the records account for exactly that. [Full Audit](${link})`;
  }

  const lead = `**${row.itemName}** came up **${pct ?? qty(Math.abs(row.variance))} ${dir}** for ${period.begin} to ${period.end} -- a variance of **${peso(row.varianceCost)}** at cost (${qty(row.variance)} units).`;
  const math = `Usage between the counts was **${qty(row.usage)}** (begin ${qty(beginTot)} + purchased ${qty(row.purchased)} + returns ${qty(row.returnedForfeits)} ${MINUS} end ${qty(endTot)}), but the records only account for **${qty(expected)}** (sold ${qty(row.soldDirect)}${row.soldViaRecipes ? ` + ${qty(row.soldViaRecipes)} via recipes` : ""}${row.nonRevenue ? ` + ${qty(row.nonRevenue)} non-revenue` : ""}${row.production ? ` + ${qty(row.production)} production` : ""}).`;
  const bullets = (records ?? [])
    .slice(0, 8)
    .map((r) => `- ${String(r.kind)} ${String(r.date)}: ${String(r.detail)}${r.amount != null ? ` (${peso(Number(r.amount))})` : ""}`)
    .join("\n");
  return `${lead}\n\n${math}${bullets ? `\n\nThe source records:\n${bullets}` : ""}\n\n[Full Audit](${link})`;
}

// ---- Entry point ----

export async function answerLocally(input: { ctx: StockyContext; locationName: string; question: string }): Promise<string> {
  const { ctx, locationName, question } = input;
  const intent = classify(question);

  switch (intent.kind) {
    case "help":
      return helpText(locationName);

    case "write":
      return `I can't change any records -- I'm read-only, so I only look things up. To make that change yourself:\n\n${screenLinks(ctx.locationId)}\n\nIf you meant to check something instead, ask me e.g. "why is Absolut short this period?" or "what did we buy last week?".`;

    case "formula": {
      const res = await callTool(ctx, "explain_formula", { name: intent.name });
      const title = String(intent.name).replace(/_/g, " ");
      return `**${title[0]!.toUpperCase()}${title.slice(1)}**\n\n${String(res.explanation)}\n\n\`${String(res.formula)}\``;
    }

    case "dashboard": {
      const d = await callTool(ctx, "get_dashboard", {});
      const period = d.period as Record<string, unknown>;
      const att = d.attention as Record<string, number>;
      const leaders = (d.varianceLeaders as Array<Record<string, unknown>>) ?? [];
      const link = String(d.link);
      if (!period.lastCountDate) {
        return `No counts have been committed yet at **${locationName}**, so there's nothing to audit. Start with a beginning count on the [Counts](/l/${ctx.locationId}/counts) screen.`;
      }
      const attItems = [
        att.missingPrices ? `- **${att.missingPrices}** item(s) missing a price` : "",
        att.unmatchedRows ? `- **${att.unmatchedRows}** import row(s) awaiting review` : "",
        att.draftPurchases ? `- **${att.draftPurchases}** purchase draft(s) to commit` : "",
        att.openCounts ? `- **${att.openCounts}** open count(s)` : "",
      ].filter(Boolean);
      const leaderLines = leaders
        .slice(0, 5)
        .map((l) => `- ${String(l.itemName)}: **${l.variancePct == null ? "—" : `${qty(Number(l.variancePct))}%`}** (${peso(Number(l.varianceCost))})`)
        .join("\n");
      return `As of the **${String(period.lastCountDate)}** count (${String(period.daysSinceLastCount)} days ago), **${locationName}** has ${String(period.countDates)} committed count date(s)${period.canAudit ? " and a Full Audit is available" : ""}.

${attItems.length ? `Needs attention:\n${attItems.join("\n")}` : "Nothing needs attention right now."}${leaderLines ? `\n\nBiggest variances this period:\n${leaderLines}` : ""}

[Dashboard](${link})`;
    }

    case "stock": {
      const item = mentionedName(question, await catalogNames(ctx));
      const toolInput: Record<string, unknown> = intent.belowParOnly ? { belowParOnly: true } : {};
      if (item && !intent.belowParOnly) toolInput.itemQuery = item;
      const res = await callTool(ctx, "get_stock", toolInput);
      const miss = noMatch(res);
      if (miss) return miss;
      const rows = (res.rows as Array<Record<string, unknown>>) ?? [];
      const link = String(res.link);
      const asOf = res.lastCountDate ? ` as of the ${String(res.lastCountDate)} count` : "";
      if (rows.length === 0) {
        return intent.belowParOnly ? `Good news -- nothing is below par right now. [Stock on hand](${link})` : `I couldn't find stock for that. [Stock on hand](${link})`;
      }
      if (item && rows.length >= 1 && !intent.belowParOnly) {
        const r = rows[0]!;
        return `**${String(r.name)}** is at **${qty(Number(r.onHand))} on hand**${asOf}, worth **${peso(Number(r.costValue))}** at cost${r.belowPar ? " -- **below par**" : ""}. [Stock on hand](${link})`;
      }
      const heading = intent.belowParOnly ? `These items are below par${asOf}:` : `Biggest positions by value${asOf}:`;
      const bullets = rows
        .slice(0, 8)
        .map((r) => `- **${String(r.name)}**: ${qty(Number(r.onHand))} on hand (${peso(Number(r.costValue))})${r.belowPar ? ` ${MID} below par` : ""}`)
        .join("\n");
      const totals = res.totals as Record<string, number> | undefined;
      const totalLine = totals ? `\n\nTotal on-hand value: **${peso(Number(totals.costValue))}** at cost, **${peso(Number(totals.retailValue))}** at retail.` : "";
      return `${heading}\n${bullets}${totalLine}\n\n[Stock on hand](${link})`;
    }

    case "variance": {
      const dates = await committedCountDates(ctx.locationId);
      const period = resolvePeriod(question, dates);
      if (!period) return `I need two committed counts to compute a variance, and this location doesn't have them yet. Commit a beginning and ending count on the [Counts](/l/${ctx.locationId}/counts) screen first.`;
      const item = mentionedName(question, await catalogNames(ctx));
      if (!item) {
        const d = await callTool(ctx, "get_dashboard", {});
        const leaders = (d.varianceLeaders as Array<Record<string, unknown>>) ?? [];
        const lines = leaders.slice(0, 5).map((l) => `- ${String(l.itemName)}: **${l.variancePct == null ? "—" : `${qty(Number(l.variancePct))}%`}** (${peso(Number(l.varianceCost))})`).join("\n");
        return `Here are the biggest variances for ${period.begin} to ${period.end}:\n${lines || "- none"}\n\nAsk me about any one of them by name to see why. [Full Audit](/l/${ctx.locationId}/reports/full-audit?begin=${period.begin}&end=${period.end})`;
      }
      if (intent.explain) {
        const res = await callTool(ctx, "explain_variance", { begin: period.begin, end: period.end, itemQuery: item });
        const miss = noMatch(res);
        if (miss) return miss;
        const links = res.links as Record<string, string>;
        return varianceNarrative(res.row as unknown as ReconRowLite, period, links.fullAudit!, res.sourceRecords as Array<Record<string, unknown>>);
      }
      const res = await callTool(ctx, "get_report_row", { begin: period.begin, end: period.end, itemQuery: item });
      const miss = noMatch(res);
      if (miss) return miss;
      const rows = (res.rows as Array<Record<string, unknown>>) ?? [];
      if (rows.length === 0) return `No audit row for "${item}" in ${period.begin} to ${period.end}.`;
      return varianceNarrative(rows[0] as unknown as ReconRowLite, period, String(res.link));
    }

    case "records": {
      const dates = await committedCountDates(ctx.locationId);
      const range = resolveRange(question, dates);
      const filterNames = intent.recordKind === "purchases" ? await supplierAndItemNames(ctx, range) : await catalogNames(ctx);
      const q = mentionedName(question, filterNames);
      const res = await callTool(ctx, "find_records", { kind: intent.recordKind, from: range.from, to: range.to, ...(q ? { query: q } : {}) });
      const miss = noMatch(res);
      if (miss) return miss;
      const rows = (res.rows as Array<Record<string, unknown>>) ?? [];
      const link = String(res.link);
      const span = `between ${range.from} and ${range.to}`;
      if (rows.length === 0) return `No ${intent.recordKind.replace("_", "-")} records${q ? ` matching "${q}"` : ""} ${span}. [Open report](${link})`;

      if (intent.recordKind === "purchases") {
        const totals = res.totals as Record<string, number>;
        const bullets = rows.slice(0, 8).map((r) => `- ${String(r.date)} ${MID} ${String(r.supplier)} ${MID} ${String(r.name)}: ${qty(Number(r.qty))} @ ${peso(Number(r.unitCost))} = **${peso(Number(r.lineTotal))}**`).join("\n");
        return `Purchases${q ? ` matching "${q}"` : ""} ${span}: **${qty(Number(totals.qty))} units** for **${peso(Number(totals.cost))}**.\n\n${bullets}\n\n[Purchases](${link})`;
      }
      if (intent.recordKind === "sales") {
        const totals = res.totals as Record<string, number>;
        const bullets = rows.slice(0, 8).map((r) => `- ${String(r.date)} ${MID} ${String(r.name)}: ${qty(Number(r.qty))} @ ${peso(Number(r.unitPrice))}${Number(r.discountPct) ? ` (${MINUS}${qty(Number(r.discountPct))}%)` : ""} -> **${peso(Number(r.net))}**`).join("\n");
        return `Sales${q ? ` matching "${q}"` : ""} ${span}: **${qty(Number(totals.qty))} units**, net **${peso(Number(totals.net))}**.\n\n${bullets}\n\n[Sales](${link})`;
      }
      const totals = res.totals as Record<string, number>;
      const bullets = rows.slice(0, 8).map((r) => `- ${String(r.date)} ${MID} ${String(r.name)} ${MID} ${String(r.reason)}: ${qty(Number(r.qty))}${r.estimatedCost != null ? ` (${peso(Number(r.estimatedCost))})` : ""}`).join("\n");
      return `Non-revenue${q ? ` matching "${q}"` : ""} ${span}: **${Number(totals.count)} entries**, ${qty(Number(totals.qty))} units, about **${peso(Number(totals.cost))}** at cost.\n\n${bullets}\n\n[Non-revenue](${link})`;
    }
  }
}

// ---- Name lists for entity extraction (read-only lookups) ----

async function catalogNames(ctx: StockyContext): Promise<string[]> {
  const report = await onHandReport(ctx.locationId);
  return report.rows.map((r) => r.name);
}

async function supplierAndItemNames(ctx: StockyContext, range: { from: string; to: string }): Promise<string[]> {
  const rep = await purchaseReport(ctx.locationId, range.from, range.to);
  const suppliers = rep.bySupplier.map((s) => s.supplier);
  const items = rep.rows.map((r) => r.name);
  const catalog = await catalogNames(ctx);
  return [...new Set([...suppliers, ...items, ...catalog])];
}
