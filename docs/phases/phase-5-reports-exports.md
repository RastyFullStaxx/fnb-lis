# Phase 5 — Report Suite & Exports

**Goal:** The full report center an accountant signs off on: every core report on-screen, exported to Excel/CSV, and printable.

## Tasks

- Reports: Sales (by day/item/kind), Purchases (by supplier/date, cost totals), Non-Revenue (by reason), Inventory on Hand (with cost & retail valuation) — each endpoint + page + `/export`
- exceljs workbooks: styled Full Audit (category groups, bold totals, red negative variance, frozen header row, auto column widths); simpler sheets for the rest; `writeBuffer()` responses with correct content-disposition filenames
- CSV exports via `core/csv`
- Print stylesheets: A4 landscape for Full Audit (repeating table header, no app chrome, report title + period + location header)
- Drill-downs: report cell → source records (counts/purchases/sales behind the number)
- Report center landing page (cards per report with last-generated info)
- Git commit

## Done when

- Every report exports .xlsx and .csv that open clean in Excel with totals matching on-screen
- Full Audit prints legibly on A4 landscape
- Drill-down from a variance cell reaches the exact source records

## Verified (2026-07-03)

- **Reports**: `report-lists.ts` — sales (transaction-level incl. menus), purchases (+ supplier rollup), non-revenue (+ reason rollup), on-hand (valuation from last-count + activity-since). All inclusive `[from,to]` ranges (the audit half-open window is Full-Audit-only). Pages under `/reports/*`, seeded to first→last count date via `useReportRange`.
- **Exports**: `exports.ts` with exceljs (styled Full Audit — frozen header, category groups, red negatives, landscape page setup) + CSV via `@fnb/core` `toCsv` (BOM for Excel). `/reports/<name>/export?format=xlsx|csv` for all five; gated on `reports.export` (readonly → 403 verified; view → 200).
- **Golden checks**: sales totals ₱17,570 gross / ₱17,520 net; purchases ₱5,106 (Metro Beverage); non-rev 3 entries / qty 4 / ₱710; on-hand ₱16,699.70 cost / ₱43,740.86 retail. xlsx re-parsed: grand total varCost −330.69, varRetail −869.57 — matches on-screen exactly.
- **Print**: `@media print` in index.css (A4 landscape, chrome stripped via data-slot hides, repeating `thead`), print-only report header (`hidden print:block`), controls `print:hidden`.
- **Drill-down**: clicking a Full Audit row → dialog of exact source records (counts, purchase, sale, menu expansion e.g. "Vodka Tonic ×12 · 45/serving", non-rev with content override, forfeit return, ending counts) — 12 records for Absolut verified.
