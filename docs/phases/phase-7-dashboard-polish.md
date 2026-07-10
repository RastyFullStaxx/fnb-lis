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

## Verified (2026-07-04)

- **Dashboard** (`services/dashboard.ts` → `/dashboard`, `pages/dashboard.tsx`): period status (days since last count, count-date count, canAudit), attention cards (missing prices / unmatched import rows / draft purchases / open counts, each a deep link and role-gated), Recharts variance leaders (top |varianceCost|, red for shortages), recent-activity feed, permission-filtered quick actions. On Prime/Main Bar the golden cycle populates it exactly: last count 2026-06-08 (26d), 2 count dates, canAudit true, 2 missing prices, leaders JD −154.71 · Absolut −100.97 · SanMig −45. Empty state for a location with no counts (Casa Verde) renders cleanly.
- **Admin surface** (server `routes/activity.ts` + web `pages/admin/{clients,users,activity}.tsx`): Clients & locations CRUD (create client → auto "Main", add location, rename); Users (create with generated password + username suggestion, role + client-access checkboxes, reset password, enable/disable — no deletes); Activity viewer with search + date range, client-scoped for non-admins. Verified all 5 seed users list with role/access/status; clients list shows Casa Verde + Prime (Main Bar, Kitchen).
- **Settings** (`routes/settings.ts` + `pages/settings.tsx`): per-client company info (feeds report branding) + global product-types editor (admin-gated). Company-info PUT/GET round-trips; product-types chips (Beverage/Food/Supplies) editable.
- **Command palette** (`components/command-palette.tsx`): Navigate + Reports groups always; Items / Menus / Suppliers groups fetched only while open. Verified real entities surface (Absolut Vodka 700 ml, Vodka Tonic menu, FreshFoods Corp).
- **Report branding**: `ReportMeta` carries legalName/address/footer; Excel exports set a print `oddFooter` (company left · note right) with no on-sheet layout shift; Full Audit print header shows company line + footer. Confirmed the downloaded xlsx embeds `<oddFooter>…Prime Hospitality Group, Inc. · 12 Ayala Ave, Makati…Confidential — internal audit use only.</oddFooter>`.
- **Analytics/telemetry, env-gated**: web `lib/analytics.ts` (PostHog + Sentry) and server `lib/telemetry.ts` (Sentry) — no keys → fully no-op, SDKs loaded lazily via indirect specifier so the default build carries no dependency; never sends inventory values or PII.
- **Role gates** (curl): accountant → `/api/activity` 403, `/api/admin/users` 403; staff → dashboard 200, `/api/settings/company` 403.
- **Sacred math untouched**: Full Audit grand total still −330.69 cost / −869.57 retail (branding is presentation-only). Both apps typecheck clean; DB reset to pristine golden seed after verification.

## Dashboard and entry refinement (2026-07-10)

- Replaced equal dashboard launch cards with a deterministic next-action resolver driven by role permissions, active-location readiness, and open work. Open counts, import review, and delivery drafts now lead users back into the unfinished record before a new workflow is offered.
- Added an operational status strip, setup checklist for new locations, explicit cost/retail variance values, a five-row location-only activity feed, retryable error state, and "All clear" readiness guards.
- Extended the dashboard aggregate with a generated timestamp, active-item readiness, resumable count/delivery details, retail variance, and activity entity metadata. Activity on the location dashboard no longer includes client-wide rows.
- Refined `/login` as the only entry surface: universal FNB/LIS language, task-focused sign-in copy, administrator-reset guidance, remember-me off by default, 44 px touch targets, field error associations, and high-contrast inline errors.
- Corrected the shared shell to one main landmark, gave sidebar controls distinct accessible names, and aligned the shared Card primitive to the documented 10 px radius, 20 px padding, and border-only depth system.
- Public marketing pages, offline/sync status, new dependencies, and automated tests remain intentionally deferred.
