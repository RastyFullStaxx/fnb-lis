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
## The 11-report list → status (BUILT 2026-07-20, second half)

| # | Report | Status |
|---|---|---|
| 1 | Full Detailed Audit Report | ✅ 24-col legacy layout (XLSX two-row merged header + CSV + PDF) via legacyAuditReport → Full Audit page “Client Formats” menu. GRAND TOTAL cross-foots with recon totals |
| 2 | Inventory Report | ✅ Same builder, variant=inventory — title + cost-of-usage/revenue ratio |
| 3 | Beginning Cost Report | ✅ cost-snapshot (side=beginning): weighted avg of committed purchases ≤ anchor date; per-row basis flag; fallback = cost price (legacy ACOST behaviour) |
| 4 | Ending Cost Report | ✅ Same page/endpoint, side=ending |
| 5 | Forfeited Bottles Report | ✅ forfeits page + exports: qty, open-content equiv, at cost & retail |
| 6 | Usage Cost Report | ✅ usage-cost page + exports (projection of recon usage/usageCost) |
| 7 | Sales Report — shot & bottle with cost and retail | ✅ sales-by-item page + exports: Shot=soldPortion, Bottle=soldDirect, Cost of Sold=(shot+bottle)×costBasis |
| 8 | Non-Revenue breakdown incl. Stock Transfer | ✅ Bucket tabs + Stock Transfer 4th tab (transfer-out lines at cost & retail); NR rows gained UOM + Est. Retail columns everywhere (screen, XLSX, CSV, PDF) |
| 9 | Production Report with cost and retail | ✅ Sales view tab (transaction-level); per-item cost/retail carried by the legacy layout |
| 10 | Variance Report | ✅ Hub card; ?variance=only filters screen AND all three export formats with honest subset totals |
| 11 | Requisition Report | ✅ Transfers report (hub card labeled “Transfers (Requisition)”) |
| — | Grand totals cost+retail; Excel / PDF / CSV | ✅ Dedicated PDF on every report (server-side pdfmake, Helvetica std fonts, exported-by footer). PDF still pending on Cost Analysis & Top Sellers (multi-section layouts) |
| — | Graphs | ✅ Analytics layer + teammate’s Top Sellers; mine StockLedger for more ideas next round |

## Decisions taken (2026-07-20, per Rasty: “decide and tell me”)

1. **Cost basis for #3/#4 — weighted average of all committed purchases up to the anchor count
   date, falling back to the item’s cost price where no purchase history exists.** The legacy
   ACOST procedure used plain qty × default_cost; the client’s “averaging price in the purchased”
   describes how they maintain that cost by hand. We implemented the averaging for real, flag
   every row with its basis, and print the basis on the report. Used ONLY in these two reports —
   reconciliation math untouched.
2. **Cost of Sold = (shot + bottle) × unit cost basis.** Verified three ways: regression on both
   sample files’ own numbers (Jack Daniels, Benchmark rows), the legacy controller’s
   usage × default_cost pattern, and our recon’s costBasis.
3. **PDF = dedicated server-side button** (client’s choice): pdfmake 0.2, standard-14 Helvetica
   (WinAnsi has no ₱ glyph → money columns carry “(PHP)” headers), landscape auto for wide
   tables, exported-by + page-count footer.
4. **Shot = recipe-portion sales; Bottle = full-unit sales** (client confirmed).
