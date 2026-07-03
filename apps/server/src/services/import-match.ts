import { FUZZY_THRESHOLD, fuzzyScore, normalizeAlias } from "@fnb/core";
import { prisma } from "../db";
import type { ParsedRow } from "./import-parse";

export interface RowMatch {
  matchedLocationItemId: string | null;
  matchedMenuItemId: string | null;
  matchMethod: "EXACT" | "ALIAS" | "FUZZY" | null;
  confidence: number | null;
  warning: string | null;
  suggestedStatus: "APPROVED" | "PENDING";
}

/**
 * Matches parsed rows to the location's catalog (and menus, for SALES):
 * saved alias → exact normalized name → fuzzy Levenshtein. Exact/alias hits
 * are pre-approved; fuzzy and misses are left for human review.
 */
export async function matchRows(
  clientId: string,
  locationId: string,
  kind: string,
  rows: ParsedRow[],
): Promise<RowMatch[]> {
  const [locationItems, menus, aliases] = await Promise.all([
    prisma.locationItem.findMany({
      where: { locationId, isActive: true },
      include: { itemVariant: { include: { unit: true, item: true } } },
    }),
    kind === "SALES"
      ? prisma.menuItem.findMany({
          where: { locationId, isActive: true },
          include: { versions: { take: 1, orderBy: { versionNo: "desc" } } },
        })
      : Promise.resolve([]),
    prisma.itemAlias.findMany({ where: { clientId } }),
  ]);

  const exactMap = new Map<string, string>();
  const candidates: Array<{ text: string; locationItemId: string }> = [];
  for (const li of locationItems) {
    const full = `${li.itemVariant.item.name} ${li.itemVariant.size} ${li.itemVariant.unit.name}`;
    for (const label of [full, li.itemVariant.item.name]) {
      const n = normalizeAlias(label);
      if (!exactMap.has(n)) exactMap.set(n, li.id);
      candidates.push({ text: n, locationItemId: li.id });
    }
  }

  const menuExact = new Map<string, string>();
  const menuCandidates: Array<{ text: string; menuItemId: string }> = [];
  for (const m of menus) {
    if (!m.versions[0]) continue; // only menus with a published recipe are sellable
    const n = normalizeAlias(m.name);
    menuExact.set(n, m.id);
    menuCandidates.push({ text: n, menuItemId: m.id });
  }

  const aliasMap = new Map<string, { locationItemId: string | null; menuItemId: string | null }>();
  for (const a of aliases) aliasMap.set(a.aliasNormalized, { locationItemId: a.locationItemId, menuItemId: a.menuItemId });

  return rows.map((row): RowMatch => {
    const n = normalizeAlias(row.itemText);

    const alias = aliasMap.get(n);
    if (alias && (alias.locationItemId || alias.menuItemId)) {
      return { matchedLocationItemId: alias.locationItemId, matchedMenuItemId: alias.menuItemId, matchMethod: "ALIAS", confidence: 1, warning: null, suggestedStatus: "APPROVED" };
    }
    if (exactMap.has(n)) {
      return { matchedLocationItemId: exactMap.get(n)!, matchedMenuItemId: null, matchMethod: "EXACT", confidence: 1, warning: null, suggestedStatus: "APPROVED" };
    }
    if (menuExact.has(n)) {
      return { matchedLocationItemId: null, matchedMenuItemId: menuExact.get(n)!, matchMethod: "EXACT", confidence: 1, warning: null, suggestedStatus: "APPROVED" };
    }

    let best: { id: string; menu: boolean; score: number } | null = null;
    for (const c of candidates) {
      const score = fuzzyScore(n, c.text);
      if (!best || score > best.score) best = { id: c.locationItemId, menu: false, score };
    }
    for (const c of menuCandidates) {
      const score = fuzzyScore(n, c.text);
      if (!best || score > best.score) best = { id: c.menuItemId, menu: true, score };
    }
    if (best && best.score >= FUZZY_THRESHOLD) {
      return {
        matchedLocationItemId: best.menu ? null : best.id,
        matchedMenuItemId: best.menu ? best.id : null,
        matchMethod: "FUZZY",
        confidence: best.score,
        warning: "Fuzzy match — please confirm",
        suggestedStatus: "PENDING",
      };
    }
    return { matchedLocationItemId: null, matchedMenuItemId: null, matchMethod: null, confidence: null, warning: "No match — pick an item", suggestedStatus: "PENDING" };
  });
}
