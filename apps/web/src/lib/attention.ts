import {
  ClipboardList,
  FileInput,
  Scale,
  ShoppingCart,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { can, type Role } from "@fnb/core";
import type { DashboardData } from "@/api/dashboard";

/**
 * Everything in this location that is waiting on someone, derived fresh from
 * the dashboard payload — never stored. That is deliberate: a stored
 * notification drifts (it still says "pending" after the work is done, and it
 * needs read/unread state per user). These items simply disappear when the
 * underlying work is finished, so the badge is always telling the truth.
 *
 * ONE source for both surfaces — the Dashboard's "Needs Attention" section and
 * the topbar bell — so the two can never disagree about what is outstanding.
 */

export type AttentionKind = "prices" | "weights" | "import" | "purchase" | "count";

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Which chunk this belongs to in the bell menu. */
  group: AttentionGroup;
}

export type AttentionGroup = "Missing data" | "Needs review" | "Open work";

/** Render order of the chunks — most blocking first. */
export const ATTENTION_GROUPS: AttentionGroup[] = ["Missing data", "Needs review", "Open work"];

export function attentionItems(data: DashboardData, role: Role): AttentionItem[] {
  const { missingPrices, missingWeights, unmatchedRows, draftPurchases, openCounts } = data.attention;
  const items: Array<AttentionItem | null> = [
    missingPrices > 0 && can(role, "prices.edit")
      ? {
          kind: "prices",
          count: missingPrices,
          label: `Complete pricing for ${missingPrices} ${missingPrices === 1 ? "item" : "items"}`,
          path: "stock",
          icon: Tags,
          group: "Missing data",
        }
      : null,
    // A bottle with no tare/liquid weight cannot be weighed at all — the
    // counter is stuck until master data is fixed (client req 2026-07-25).
    missingWeights > 0 && can(role, "master.write")
      ? {
          kind: "weights",
          count: missingWeights,
          label: `Set bottle weights for ${missingWeights} ${missingWeights === 1 ? "item" : "items"}`,
          path: "stock",
          icon: Scale,
          group: "Missing data",
        }
      : null,
    unmatchedRows > 0 && can(role, "imports.upload")
      ? {
          kind: "import",
          count: unmatchedRows,
          label: `Review ${unmatchedRows} unmatched import ${unmatchedRows === 1 ? "row" : "rows"}`,
          path: "imports",
          icon: FileInput,
          group: "Needs review",
        }
      : null,
    draftPurchases > 0 && can(role, "entries.create")
      ? {
          kind: "purchase",
          count: draftPurchases,
          label: `Continue ${draftPurchases} delivery ${draftPurchases === 1 ? "draft" : "drafts"}`,
          path: "purchases",
          icon: ShoppingCart,
          group: "Open work",
        }
      : null,
    openCounts > 0 && can(role, "entries.create")
      ? {
          kind: "count",
          count: openCounts,
          label: `Continue ${openCounts} open ${openCounts === 1 ? "count" : "counts"}`,
          path: "counts",
          icon: ClipboardList,
          group: "Open work",
        }
      : null,
  ];
  return items.filter((item): item is AttentionItem => item !== null);
}

/** Total pieces of outstanding work — the number on the bell. */
export function attentionCount(items: AttentionItem[]): number {
  return items.reduce((n, i) => n + i.count, 0);
}
