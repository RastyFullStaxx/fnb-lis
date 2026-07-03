# Phase 6 — File Imports (Deterministic + AI)

**Goal:** Staff drop a POS export or a scanned supplier report; the system extracts rows, matches them to items, and a human reviews before anything touches inventory. Reversible as a batch.

## Tasks

- Upload endpoint (Hono body parse, multipart): store under `apps/server/data/uploads/` with sha256; kind selector (SALES | PURCHASES | NON_REVENUE | COUNTS); size/type limits (≤ 20 MB for AI path — Anthropic 32 MB request cap after base64)
- Deterministic parsers: CSV (papaparse) + XLSX (exceljs read) with column-mapping heuristics (qty/price/amount/date/name detection)
- AI extractor behind an `extractor.ts` interface: `@anthropic-ai/sdk`, model `claude-sonnet-5`, **structured outputs** (`messages.parse` + `zodOutputFormat(importExtractionResult)`), PDF as base64 `document` block / images as `image` blocks; env-gated — no `ANTHROPIC_API_KEY` → PDF/image shows a setup notice, CSV/XLSX still work; raw extraction JSON stored on the batch
- Matching pipeline: exact (normalized name) → `ItemAlias` → fuzzy (normalized Levenshtein) with confidence score; menu names match too (SALES kind)
- Review grid: editable rows, match combobox with EXACT/ALIAS/FUZZY badges + confidence, warnings, bulk approve/reject
- Commit: approved rows → SaleRecords/PurchaseLines (with `resultType`/`resultId` backlinks), batch → COMMITTED, ActivityLog entry; **manual matches write ItemAlias** (per-client memory)
- Reverse: void exactly the created records, batch → REVERSED
- Git commit

## Done when

- A messy sample sales CSV commits correctly and its numbers appear in the Full Audit
- Re-importing the same vendor's file auto-matches via saved aliases
- Reversal restores the prior report numbers exactly
- Without an API key: CSV path fully works; PDF/image path shows the setup notice (no crash)

## Verified (2026-07-03)

- **Parsers**: `import-parse.ts` — papaparse CSV + exceljs XLSX with header heuristics (name/qty/price/cost/date), currency/number cleanup, date normalization. `import-extract.ts` — env-gated Anthropic `claude-sonnet-5` via `messages.parse` + `zodOutputFormat(importExtractionResult)`, PDF `document` / image blocks; built but not live-tested (no key in this env — AI path is exercised only through the env guard).
- **Matching**: `import-match.ts` alias → exact (full label + plain item name, normalized) → fuzzy (`@fnb/core` Levenshtein, threshold 0.6); menus included for SALES. EXACT/ALIAS auto-approved, FUZZY/miss left PENDING.
- **Routes**: upload (multipart, 20 MB cap, sha256 store under `data/uploads/`), list, detail, row update (manual match → MANUAL + exclusive item/menu), commit (SALES/NON_REVENUE → SaleRecord per row; PURCHASES → Purchase-per-date + lines; `resultType`/`resultId` backlinks; **alias write-back for non-EXACT rows**), reverse (voids exactly the created records → batch REVERSED). COUNTS parked from the picker (needs count-session semantics).
- **Gates verified end-to-end (server + UI)**: messy `pos-export.csv` → 2 EXACT auto-approved (incl. case-insensitive "absolut vodka"), 1 unmatched; manual-matched "Jack Daniels" → committed 3 rows → Full Audit reflected (SanMig 30→35, JD 2→3, Absolut 3→4); **re-import auto-matched "Jack Daniels" as ALIAS**; **reverse voided 3 records and restored the report byte-for-byte** (variance arrays identical to baseline). No-key PDF upload → 400 friendly setup notice; `aiEnabled=false`; staff (no `imports.upload`) → 403.
- **Web**: Imports page (kind selector, drag/drop dropzone, AI-gated `accept` + setup notice) and review grid (match combobox with EXACT/ALIAS/FUZZY%/MANUAL badges, warnings, per-row approve/reject, bulk approve-matched/reject-unmatched, commit with confirm, reverse with confirm).
