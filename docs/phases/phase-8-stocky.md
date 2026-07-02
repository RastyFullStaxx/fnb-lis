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
