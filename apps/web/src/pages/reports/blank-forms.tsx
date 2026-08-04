import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { NON_REVENUE_REASON_WORDS, toCsv } from "@fnb/core";
import { useCurrentLocation, useLocationItems } from "@/api/location";
import { formatDate } from "@/lib/utils";
import type { LocationItem } from "@/api/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Blank entry forms for Sales, Purchases and Non-Revenue (client req
 * 2026-08-02): "pwede mag generate ng form si system na printable or soft copy
 * … dun na lang mag input as options si user … then import nya yun file".
 *
 * The whole point is the ROUND TRIP, so the column headings are not a design
 * choice — they are the contract with `services/import-parse.ts`, which finds
 * its columns by regex:
 *
 *   name  /item|product|name|description|bottle|brand|particular/
 *   qty   /qty|quantity|count|units?\b|sold|pcs/
 *   price /price|srp|retail|sell|amount|sales|total/
 *   cost  /cost|unit ?cost|buy|purchase/
 *   date  /date|day/
 *
 * Every heading below was checked against those. Rename one to something
 * prettier and the file still downloads, still prints, still looks right — and
 * silently imports as a column of nulls.
 *
 * **Column ORDER is load-bearing too, in one specific way.** `NAME_RE` includes
 * `bottle`, so "Quantity (bottles)" matches the item-name pattern as well as
 * the quantity one. The parser takes the FIRST match for a name, and "Item"
 * precedes it in every form here — which is the only reason it resolves
 * correctly. Verified: a purchase row imports `itemText: "Absolut Vodka 700 ml"`
 * and `qty: 24`. Move the quantity column ahead of Item and the item name
 * silently becomes the number 24.
 *
 * These are NOT copies of the client's paper. Their sheets are the starting
 * point and the source of what the columns must mean, but each one here fixes
 * something the paper loses — see the Non-Revenue spec below for the clearest
 * case. Columns the parser has no field for (Remarks, Supplier) are kept
 * because a human reads them; `Reason` is read at commit time out of the stored
 * raw row (routes/imports.ts, reasonFromRaw).
 */

type Kind = "sales" | "purchases" | "non-revenue";

interface FormSpec {
  title: string;
  /** Column headings. Order matters for print; names matter for import. */
  columns: string[];
  /** Which column holds the item name, so pre-fill knows where to put it. */
  itemColumn: number;
  description: string;
  /** Their paper sheet ends with a sign-off; ours should too where it applies. */
  approvedBy?: boolean;
  /** Print the accepted reason words, so nobody has to remember them. */
  reasonLegend?: boolean;
  /** A line about what unit the quantity is in — printed on the sheet. */
  unitNote?: string;
}

const FORMS: Record<Kind, FormSpec> = {
  sales: {
    /**
     * "Quantity (bottles)" rather than "Quantity", and the unit is the point.
     * A sales sheet mixing shots and bottles under one heading is the same
     * ambiguity the purchase form has below, in a place where it is easier to
     * miss because most lines are whole bottles.
     */
    title: "Sales Entry Form",
    columns: ["Date", "Item", "Quantity (bottles)", "Price", "Discount %", "Remarks"],
    itemColumn: 1,
    description:
      "For encoding a day's sales by hand, then importing the file. One line per item sold.",
    unitNote: "Quantity is in BOTTLES or pieces — the unit the item is counted in, never cases.",
  },
  purchases: {
    /**
     * Their supplier invoices read "Bench Mark No.8 Bourbon 750mL X12" with a
     * quantity of 14 — and nothing on the paper says whether that is 14 bottles
     * or 14 cases of twelve. Off by a factor of twelve is not a rounding error;
     * it is a purchase that never reconciles against the next count.
     *
     * Fixed at the point of entry rather than guessed at import: the heading
     * names the unit, and a Pack Size column gives somebody copying an invoice
     * with "X12" on it somewhere honest to put it. The parser reads
     * "Quantity (bottles)" through the same /qty|quantity/ rule and ignores
     * Pack Size, which is for the human checking the delivery.
     */
    title: "Purchase / Delivery Form",
    columns: ["Date", "Item", "Pack Size", "Quantity (bottles)", "Unit Cost", "Amount", "Supplier"],
    itemColumn: 1,
    description:
      "For a delivery received on paper. Copy the invoice, but convert cases to bottles — the system counts bottles.",
    unitNote:
      "If the invoice says \"750mL X12\", write 12 under Pack Size and the TOTAL BOTTLES under Quantity — not the number of cases.",
  },
  "non-revenue": {
    /**
     * Their sheet, improved in two places rather than copied.
     *
     * Theirs is DATE / PRODUCT / QUANTITY / REMARKS / SIGNATURE with an
     * APPROVED BY line, and it loses information twice over:
     *
     * - **Reason lived in free-text Remarks.** "Bleed", "R&D" and a sentence
     *   about a broken bottle all landed in one column, so nothing could total
     *   them. Reason is now its own column, with the accepted words printed on
     *   the sheet, and `nonRevenueGroupOf` folds each into a canonical bucket —
     *   so the Non-Revenue report's by-reason breakdown finally covers imported
     *   rows and not just hand-typed ones. Remarks stays, for the sentence.
     * - **The per-row Signature column was blank on every row** of the sheet
     *   they sent, while APPROVED BY at the foot was signed. A column nobody
     *   fills is width taken from the ones they do. Dropped — the sign-off
     *   stays, and the system already records who entered each line.
     */
    title: "Non-Revenue Form",
    columns: ["Date", "Product", "Quantity", "Reason", "Remarks"],
    itemColumn: 1,
    description:
      "Bleed, spoilage, tasting, R&D — stock that left without a sale. The reason goes in its own column so the report can total it.",
    approvedBy: true,
    reasonLegend: true,
  },
};

const ROW_CHOICES = [20, 40, 60] as const;

export function BlankFormsPage() {
  const location = useCurrentLocation();
  const catalog = useLocationItems();
  const [kind, setKind] = useState<Kind>("sales");
  const [rowCount, setRowCount] = useState<number>(40);
  const [prefill, setPrefill] = useState<"blank" | "catalog">("blank");

  const spec = FORMS[kind];

  /**
   * Pre-filled item names are the difference between a form that imports and
   * one that mostly does not. Free-typed names have to survive fuzzy matching;
   * names printed from this location's own catalog match exactly.
   */
  const items = useMemo(() => {
    const rows = (catalog.data ?? []).filter((r) => r.isActive);
    const label = (r: LocationItem) =>
      `${r.itemVariant.item.name} ${r.itemVariant.size ?? ""} ${r.itemVariant.unit?.name ?? ""}`
        .replace(/\s+/g, " ")
        .trim();
    return rows.map(label).sort((a, b) => a.localeCompare(b));
  }, [catalog.data]);

  const rows: string[][] = useMemo(() => {
    const blank = () => spec.columns.map(() => "");
    if (prefill === "catalog") {
      return items.map((name) => {
        const row = blank();
        row[spec.itemColumn] = name;
        return row;
      });
    }
    return Array.from({ length: rowCount }, blank);
  }, [prefill, items, rowCount, spec]);

  const download = () => {
    // Same headings as the print view, so whichever route someone takes the
    // file lands in the importer the same way.
    const csv = toCsv([spec.columns, ...rows]);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${kind}-form-${location?.name ?? "location"}-${stamp}.csv`.replace(/\s+/g, "-");
    // A plain Blob, not the server: a blank template has no data to fetch, and
    // a round trip to generate empty rows would be a route that exists to
    // return nothing.
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Blank Entry Forms"
        actions={
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="flex items-center gap-2">
              <Label htmlFor="bf-kind" className="text-sm text-muted-foreground">
                Form
              </Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger id="bf-kind" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="purchases">Purchases</SelectItem>
                  <SelectItem value="non-revenue">Non-Revenue</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="bf-fill" className="text-sm text-muted-foreground">
                Rows
              </Label>
              <Select
                value={prefill === "catalog" ? "catalog" : String(rowCount)}
                onValueChange={(v) => {
                  if (v === "catalog") return setPrefill("catalog");
                  setPrefill("blank");
                  setRowCount(Number(v));
                }}
              >
                <SelectTrigger id="bf-fill" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROW_CHOICES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} blank rows
                    </SelectItem>
                  ))}
                  <SelectItem value="catalog">Item names filled in</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" onClick={download}>
              <Download className="size-4" /> CSV
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="size-4" /> Print
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border p-6 print:border-0 print:p-0">
        <header className="mb-4">
          <h1 className="text-base font-semibold">
            {spec.title} — {location?.name ?? ""}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{spec.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Printed {formatDate(new Date().toISOString().slice(0, 10))}. Keep the column headings as
            they are — the importer reads them to know which column is which.
          </p>
        </header>

        {catalog.isPending && prefill === "catalog" ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                {spec.columns.map((c) => (
                  <th key={c} className="py-1 pr-3 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b">
                  {row.map((cell, j) => (
                    <td key={j} className="py-1.5 pr-3 align-bottom">
                      {cell ? (
                        <span className="text-xs">{cell}</span>
                      ) : (
                        // Ruled write-in box, same as the count sheet: an
                        // underline tells someone where the number goes.
                        <span className="block h-4 border-b border-dashed border-muted-foreground/50" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {spec.unitNote && (
          <p className="mt-4 max-w-prose text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">Units:</span> {spec.unitNote}
          </p>
        )}

        {spec.reasonLegend && (
          // Printed ON the sheet, not shown only in the app: whoever fills this
          // in is holding paper next to a beer line, not looking at a screen.
          <p className="mt-4 max-w-prose text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">Reason — use one of:</span>{" "}
            {NON_REVENUE_REASON_WORDS.join(" · ")}. Anything else still records, but it groups under
            &ldquo;Other&rdquo; in the report.
          </p>
        )}

        {spec.approvedBy && (
          <div className="mt-8 flex items-end gap-3 text-sm">
            <span className="font-medium">Approved by:</span>
            <span className="h-4 w-64 border-b border-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
