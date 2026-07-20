# Client report formats — the answer key for request #11

Received 2026-07-20 from Lourd (GC): two XLSX examples + an 11-report list. The XLSX files live at
`C:\Users\MSI\OneDrive\Desktop\Bar-Full-Detailed-Audit-January-25-to-31J-2025.xlsx` and
`…\Bar-Inventory-Report-January-25-to-31LJ-2025.xlsx` — copy them into `docs/reference/` before
they vanish from the Desktop.

## The shared layout (both examples use the SAME table)

Both files carry one sheet, one table, identical columns; they differ only in title and headline
ratio. Header block: `Detailed Full Audit Report: Bar` / `Inventory Report: Bar`, `Period: …`,
and top-right **Beverage Cost** = cost of **sold**/revenue (Detailed Audit) or cost of
**usage**/revenue (Inventory Report). Rows are grouped by category with a `<CATEGORY> TOTAL`
row and a blank spacer between groups. Two-row header:

| Col | Header (row 1 / row 2) | Our field (ReconRow) |
|---|---|---|
| 1 | Product Name | item name (without size — size is its own column) |
| 2 | Size | `size` |
| 3/4 | Beginning Inventory: Full / Open | `beginFull` / `beginOpenEquiv` |
| 5 | B-Cost | `beginCost` |
| 6 | Purchased | `purchased` |
| 7 | Purchased Cost | ⚠️ not echoed in `ReconRow` yet (the assembly agg has it) — additive echo needed |
| 8 | F (forfeited) | `forfeited` |
| 9/10 | Ending Inventory: Full / Open | `endFull` / `endOpenEquiv` |
| 11 | E-Cost | `endCost` |
| 12 | USAGE | `usage` |
| 13 | Cost of Usage | `usageCost` |
| 14/15 | Sales: Shot / Bottle | `soldPortion` (recipe/shot) / `soldDirect` (full-unit) |
| 16 | Cost of Sold | ⚠️ derived: sold × cost basis — confirm exact legacy formula in `fnb-main` |
| 17 | Revenue | `revenue` |
| 18 | Variance Used vs Sales | ≈ variance EXCLUDING non-rev (see below) |
| 19/20 | Non Rev: Usage / Cost | `nonRevenue` / `nonRevenueCost` |
| 21 | Overall Variance Over/Short | `variance` (ours already nets non-rev into expected use) |
| 22 | %Over/Short | `variancePct` |
| 23 | Cost | `varianceCost` |
| 24 | At Retail | `varianceRetail` |

**Variance semantics (verified on the Summit row):** `Overall Variance (−27) = Used-vs-Sales
(−47) + Non-Rev Usage (20)`. Legacy shows the sales-only gap first, then adds non-rev back.
Our `variance` equals their **Overall** column; their col 18 = `variance − nonRevenue`
(sign-check against `fnb-main` before shipping).

## The 11-report list → status

| # | Report | Status / source |
|---|---|---|
| 1 | Full Detailed Audit Report | Layout above; ~90% is existing `ReconRow` data. Needs: purchasedCost echo, Cost-of-Sold formula, legacy-layout export |
| 2 | Inventory Report | SAME table; title + headline ratio differ. One builder, two titles |
| 3 | Beginning Cost Report (item, uom, qty, cost) | New; **cost = averaged purchase price** — methodology differs from our count-time snapshots. Needs sign-off (deviation candidate) |
| 4 | Ending Cost Report | Same as #3, ending side |
| 5 | Forfeited Bottles Report (qty, cost, retail) | New simple listing from `Forfeit` records |
| 6 | Usage Cost Report (item, uom, qty, cost) | Projection of recon rows (usage, usageCost) |
| 7 | Sales Report — shot and bottle, cost AND retail | Ours exists; needs shot/bottle split + cost column |
| 8 | Non-Revenue breakdown: Spoilage & Spillage / Trimmings / OTH & Marketing / **Stock Transfer** | Buckets shipped 2026-07-20 ✅; **Stock Transfer as a 4th group** = transfers presented in NR clothing (legacy recorded transfers as non-rev inputs; ours are first-class) — add a Stock Transfers tab fed from TransferLine |
| 9 | Production Report (bar + kitchen) with cost and retail | View shipped ✅; needs cost/retail columns |
| 10 | Variance Report (only items WITH variance) cost + retail | UI filter shipped ✅ (`Variance Only`); needs hub card + variance-only export |
| 11 | Requisition Report (transfer out → in, cost & retail) | ✅ Our Transfers report IS this; consider "Requisition" alias in the UI |
| — | All reports: grand total cost + retail; Excel / **PDF** / CSV | Excel+CSV exist. **PDF is new** — decide: print-stylesheet route (browser Save-as-PDF, cheap) vs server-side rendering (heavy). Recommend print-first |
| — | Graphs: keep legacy's, add ideas from StockLedger prototype | Analytics layer shipped 2026-07-20 (trends, verdict strip, per-report charts); mine `C:\xampp\htdocs\StockLedger` for more |

## Open decisions for the client

1. **Averaged purchase cost** (#3/#4) vs our snapshot costs — changes numbers; needs explicit OK.
2. **Cost of Sold formula** — confirm from legacy code (`fnb-main`), not guessed.
3. **PDF**: is browser print-to-PDF acceptable (recommended), or must the server emit PDFs?
4. Shot = recipe-portion sales, Bottle = full-unit sales — confirm mapping matches their POS habits.
