# Phase 1 — Foundation

**Goal:** A running skeleton: workspaces, full database schema, domain core, authenticated API, and the app shell with login — every later phase is "add a module," never "restructure."

## Tasks

- Root npm workspace (`apps/*`, `packages/*`), `"type": "module"` everywhere, root `dev` script via `concurrently`
- `packages/core`: `rounding.ts` (phpRound), `units.ts`, `weighing.ts`, `constants.ts` (roles/statuses/permission matrix), `schemas/` (auth + shared DTO start), exported as TS source (`exports` → `./src`)
- `apps/server`: Prisma schema — **all 25 models on day one** (migrations additive afterwards); `prisma migrate dev`; WAL + busy_timeout boot pragmas; seed v1 (5 role users pw `Fnb!2026`, clients "Prime Hospitality Group" [Main Bar, Kitchen] + "Casa Verde Restaurant" [Main], units, categories with legacy density factors, `productTypes` setting); Hono app with session middleware, `/api/auth` (login/logout/me with lockout), `/api/admin` skeleton, error handler, ActivityLog plumbing (login/logout recorded), static-serve for prod
- `apps/web`: Vite + React 19 + TS; Tailwind v4 (`@tailwindcss/vite`, CSS-first, **no tailwind.config.js**); shadcn init + DESIGN.md theme tokens; Geist fonts; React Router v7 library mode with `/l/:locationId/*` layout; TanStack Query client; Login page (lockout states); app shell (royal sidebar, topbar client/location switcher persisted in URL, Ctrl+K palette shell, Sonner)
- `.gitignore` (node_modules, dist, `apps/server/data/`, `.env`), `apps/server/.env.example`
- Git commit at phase end

## Done when

- `npm run dev` starts web (5173) + server (3001); `/api` proxied same-origin
- Each seeded role logs in and sees role-appropriate nav; wrong password ×5 locks for 1 h
- Non-ADMIN requesting another client's location gets 403
- Logins/logouts appear in ActivityLog

## Gotchas (Windows)

Stop the dev server before `prisma generate`/`migrate` (EPERM file lock) · install from repo root only · `@` alias must be in both tsconfig and vite config before running the shadcn CLI
