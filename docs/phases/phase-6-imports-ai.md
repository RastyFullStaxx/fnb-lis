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
