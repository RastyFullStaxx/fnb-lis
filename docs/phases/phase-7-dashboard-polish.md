# Phase 7 — Dashboard, Admin & Polish

**Goal:** The system feels finished: an operational dashboard, complete admin surface, and a design pass that earns the "premium" adjective.

## Tasks

- Dashboard: current period status card (days since last count), variance leaders (Recharts bar, destructive for shortages), attention cards (missing prices, unmatched import rows, drafts pending commit), recent activity feed, quick actions (Start Count, Receive Purchase, Record Sale, Import File)
- Admin: Clients & Locations CRUD, Users (create with generated credentials, role, client assignments, disable, reset password — no deletes), Activity log viewer (filters: user/entity/date), Settings (product-types editor, company info, report preferences)
- Command palette completion: entity search (items, menus, suppliers, report jump)
- Empty/loading/error states on every route (skeletons shaped like content; empty states teach)
- Keyboard audit on entry screens (counts/sales/purchases fully mouse-free)
- Design pass using the repo skills: `impeccable` (product register — component consistency, contrast, density) and `design-motion-principles` (audit motion; 150–250 ms state-only)
- PostHog + Sentry wiring, env-gated (no keys → fully disabled; no inventory values/PII in events per AGENTS.md)
- Print/export header branding (LIS wordmark, client + location + period)
- Git commit

## Done when

- No route shows an unstyled or dead-end state
- A brand-new client + location + user can be onboarded entirely through the UI
- Entry screens operable mouse-free end-to-end
- Design pass findings addressed (documented in the commit message)
