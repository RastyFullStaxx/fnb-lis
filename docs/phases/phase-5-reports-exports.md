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
