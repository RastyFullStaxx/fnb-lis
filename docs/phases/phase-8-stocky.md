# Phase 8 — Stocky Assistant (last, per AGENTS.md)

**Goal:** A genuinely useful, provably read-only assistant that explains the numbers — the StockLedger prototype's rule-based UX, re-implemented with a real LLM grounded in live data.

## Tasks

- `/api/stocky/chat`: streaming endpoint (`@anthropic-ai/sdk`, `claude-sonnet-5`), tool loop over **strictly read-only tools** reusing existing service functions, scoped by the caller's session/role/location:
  - `get_stock(itemQuery)` — on-hand + last count info
  - `get_report_row(period, itemQuery)` — reconciliation row for an item
  - `explain_variance(period, itemQuery)` — row + the source records behind each term
  - `find_records(kind, filters)` — sales/purchases/counts/imports search
  - `explain_formula(name)` — canned formula explanations from architecture.md §6
- System prompt: answer from tool results only; cite record links (`/l/:loc/...`); never claim ability to change data; decline write requests pointing to the right screen
- UI: Sheet slide-over chat (topbar button), suggested prompts ("Why is Absolut short this period?", "What did we buy from Metro Beverage last week?", "How is remaining bottle content calculated?"), streaming render, message links navigate the app
- Env-gated: no API key → panel shows setup notice
- Hard rule verification: no mutating tool registered — confirm by code review of the tool registry (single file)
- Git commit

## Done when

- "Why is Absolut short this period?" yields a grounded answer with the actual variance number and links to the source records
- Stocky refuses/redirects write requests; the tool registry contains zero mutating tools
- Without an API key the panel degrades to a setup notice

## Verified (2026-07-04)

**Design pivot (user request): Stocky is a working chatbot with NO API key**, and a key transparently upgrades the same endpoint to free-form LLM conversation. So the "no key → setup notice" gate was replaced by "no key → deterministic rule engine."

- **Read-only tool registry** (`services/stocky-tools.ts`) — 6 tools (`get_stock`, `get_report_row`, `explain_variance`, `find_records`, `get_dashboard`, `explain_formula`) wrapping the existing report services. Provably write-free: its only imports are `report-assembly`/`report-lists`/`dashboard` (reads) and `@fnb/core` matching helpers — no Prisma, no writes (confirmed by grep). Each result is size-capped, 2dp-rounded, and embeds real `/l/:loc/...` record links (the only link source the model/engine sees). `explain_formula` serves canned prose transcribed from architecture.md §6.
- **No-key rule engine** (`services/stocky-engine.ts`) — intent classify → entity/period extraction (reverse fuzzy-match against live catalog/supplier names) → run the same tools → compose a plain-text answer with real numbers + links. Ported in spirit from the StockLedger prototype's rule assistant; write requests are refused with screen links.
- **AI path** (`services/stocky-prompt.ts` + `routes/stocky.ts`) — when `ANTHROPIC_API_KEY` is set, a `claude-sonnet-5` streaming tool loop (manual: text deltas → `finalMessage()` → append `content` verbatim → tool_results in one user message, ≤6 turns, `effort: low`, no sampling params) over the same registry.
- **Transport** — `POST /api/locations/:locationId/stocky/chat`, `streamSSE` with `text`/`tool`/`done`/`error` events; the web client reads via `fetch` + `ReadableStream` (EventSource can't POST). Ephemeral client-held text-only history (last 20, char-capped). `requirePermission("reports.view")`; location from session context, never the body. Every turn logged to ActivityLog (`stocky.chat`, `{mode, outcome}`) after the stream closes.
- **UI** — `components/stocky/stocky-sheet.tsx` (right Sheet, Sparkles topbar button, suggested prompts, streaming typewriter, tool-status chips, Stop/Regenerate, "Basic"/"AI" badge + basic-mode hint) + `markdown-lite.tsx` (paragraphs/bold/code/bullets/links; `/l/` links become router `<Link>`s that close the sheet, everything else plain text = XSS guard). Report deep links honored via `use-report-range.ts` + `full-audit.tsx` search-param seeding.
- **Gates, verified live against the golden seed (Prime/Main Bar) with NO key**:
  - "Why is Absolut short this period?" → **3.52% short**, **−₱100.97** at cost, full usage math, source records, and a Full Audit deep link that navigates + applies the 2026-06-01→06-08 range (grand total still **−₱330.69**).
  - "What did we buy from Metro Beverage last week?" → the June-3 Metro purchase lines with amounts + a Purchases link.
  - "How is remaining bottle content calculated?" → the weigh formula.
  - "What needs my attention?" → dashboard variance leaders (JD −7.53%, etc.).
  - "Delete the last count" / "Change Absolut's par to 6" → refusal + Counts/Items links; DB untouched.
  - SSE streams incrementally through the Vite proxy; ActivityLog rows carry `mode:"local"`.
  - With a (fake) key, the same endpoint switches to `text/event-stream` LLM mode and surfaces the Anthropic error path cleanly — the real LLM conversation just needs a valid key.
- Sacred math untouched (`packages/core` only consumed). Both apps typecheck clean; DB reset to pristine seed.
