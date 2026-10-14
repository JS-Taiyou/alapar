# A la Par

**English** | [Español](README.es.md)

> Split shared expenses with your partner, friends, or roommates — and always
> settle _a la par_ (dead even).

![License](https://img.shields.io/badge/license-AGPLv3-blue)
![Demo](https://img.shields.io/badge/demo-live-brightgreen)

**[▶ Try the live guided demo — no signup needed](https://alapar.itzayanos.deno.net/demo)**
**Live app:** https://alapar.itzayanos.deno.net _(still served by the original
Fresh build while this migration lands)_

## Project history

A la Par was born as a **Deno** project, built on Deno's own web framework
**Fresh** (Preact + server-rendered islands) and deployed on **Deno Deploy**.
When Deno's acquisition by Cloudflare was announced, the project was ported to
**Astro 7 running on Node**, with Netlify as the new hosting target. The
original Fresh codebase remains on the `main` branch; the migration lives on
`migration/astro` — see [`MIGRATION.md`](MIGRATION.md) for the port map,
verification status, and what remains.

## What it is

A la Par is a full-stack expense-splitting PWA for Spanish-speaking users.
Create a group ("registro"), log expenses and payments, and the app keeps a
running balance of who owes whom — across installments, recurring charges, and
direct payments between members.

- **Groups for any context** — couples, roommates, trips; users can belong to
  multiple groups
- **Installments & recurring charges** — tracks remaining cycles per purchase
  and ongoing subscriptions
- **Automatic balance calculation** — nets out arbitrary payments between any
  two members
- **"Corte de ejercicio" (period closing)** — archive a period's transactions
  and start with a clean slate; unsettled balances carry forward as opening
  transactions so nothing is lost
- **Searchable history** — search closed periods by name, and revisit them
  anytime
- **Bilingual UI** — Spanish/English with a per-user toggle
- **Installable PWA** — optimistic updates, client-side caching via service
  workers, and add-to-home-screen on Android and desktop
- **Version-polled sync** — changes from other members arrive through an
  hourly version check against an edge KV mirror (cheap: no database hit
  when nothing changed), plus an immediate refresh on app focus

## Tech stack

| Layer     | Tech                                                             |
| --------- | ---------------------------------------------------------------- |
| Frontend  | Astro 7 + React 19, server-rendered + hydrated components        |
| Runtime   | Node.js 22.12+ (npm, Astro CLI; Vite 8 under the hood via Vite+) |
| Tooling   | Vite+ (`vp`) — lint (Oxlint), format (Oxfmt), tests (Vitest)     |
| Backend   | Supabase — Postgres, Auth (email/password + Google OAuth), RLS   |
| Styling   | Tailwind CSS + DaisyUI (dark theme)                              |
| Hosting   | Netlify (SSR via @astrojs/netlify) — migration in progress       |
| Packaging | PWA (web manifest + service worker + Web Push)                   |

## Engineering highlights

- **Money math in integer cents** — the split engine and persisted balance
  deltas use exact integer-cents arithmetic, and the API validates that split
  shares sum to the transaction total before anything is stored.
- **Deterministic remainder distribution** — when a split doesn't divide evenly,
  leftover cents are assigned reproducibly (seeded by a per-transaction UUID),
  so balances are auditable and fair in aggregate.
- **Exact balance persistence** — per-user deltas are stored as `NUMERIC(12,2)`
  in a `transaction_balances` table and summed via exact SQL arithmetic,
  eliminating the 1-2 cent discrepancies that accumulate with float-based
  running totals. Multi-statement writes (transaction + payments + deltas,
  invitation joins, batch cloning) run inside DB transactions, so a partial
  failure can't leave balances drifted.
- **Sync without sticky connections** — the polling client compares a
  Postgres-sourced version stamp mirrored to Workers KV; a mismatch pays for
  one full refetch, a match costs a millisecond KV read. Own mutations
  return their stamp in the response, so they never trigger a self-refetch.
- **Security enforced in the database** — Postgres Row-Level Security isolates
  every group's data; the API layer only ever queries registries the
  authenticated user belongs to.

## Running locally

### Prerequisites

- [Node.js](https://nodejs.org) 22.12+ and npm 9.6.5+ with Docker for the
  local Postgres — a [Supabase](https://supabase.com) project (free tier) is
  only needed for the full auth/billing backend

### Zero-config dev loop (no Supabase needed)

The dev server runs entirely against a local Postgres — no Supabase, no
OAuth, no Polar, no credentials:

```bash
git clone https://github.com/JS-Taiyou/alapar-fresh.git
cd alapar-fresh
git checkout migration/astro
npm install
docker compose up -d db     # local Postgres (alapar/alapar/alapar)
npm run db:schema           # apply db/schema.sql
npm run db:seed             # optional: demo users + registries
npm run dev                 # http://localhost:4321
```

On `/login`, **any password is accepted** — the email you type finds (or
creates on first sight) the account in the local database, and the session
lives in a dev-only cookie. The Google button, the password-recovery links
and all Supabase touchpoints are hidden in dev. Seeded users:
`john@example.com`, `jane@example.com`, `bob@example.com`. To iterate on
the real Supabase auth flow locally instead, set `DEV_AUTH=off` in `.env`.

**Full backend (Supabase).** Set `DATABASE_URL` to your Supabase pooler URL
plus the `SUPABASE_*` vars from `.env.example`; when `DATABASE_URL` is unset,
`src/lib/db.ts` falls back to the same local Postgres. For the Supabase
project itself, run the migrations in `db/` in the order listed in
[`docs/DATABASE.md`](docs/DATABASE.md#migrations). Billing endpoints stay
dormant (503) without `POLAR_*` vars — the pricing page renders regardless.

### Commands

```bash
npm run dev        # dev server
npm run build      # production build (Cloudflare Workers)
npm run preview    # preview the build
npm run check      # type-check (.astro + .ts via astro check)
npm run lint       # Oxlint via Vite+ (type-aware)
npm run fmt        # Oxfmt via Vite+ (use fmt:check to verify only)
npm test           # Vitest via Vite+ (passes while the suite is being ported)
npm run db:schema  # apply db/schema.sql to the local docker Postgres
npm run db:seed    # apply db/seed.sql (demo users + registries)
```

## Testing

```bash
npm test           # Vitest suite (489 tests, DB stubbed — no DATABASE_URL needed)
```

The suite covers the balance/splitting engine (shares always sum to the
total, deviation ≤ one cent, deterministic splits), route handlers (against a
stubbed query layer), and the migration's new runtime behavior (env accessor,
local-Postgres fallback, reimplemented CSRF). See
[`MIGRATION.md`](MIGRATION.md#tests) for the Deno→Vitest porting notes.

## Documentation

- [`MIGRATION.md`](MIGRATION.md) — Fresh → Astro port map and remaining work
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture,
  directory structure, auth flow, caching, sync
- [`docs/BUSINESS_LOGIC.md`](docs/BUSINESS_LOGIC.md) — balance calculation,
  split modes, cortar/settle, carry-forward, invitations
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema, tables, migrations
- [`docs/ROUTES.md`](docs/ROUTES.md) — route inventory
- [`docs/ISLANDS.md`](docs/ISLANDS.md) — interactive components
- [`docs/COMPONENTS.md`](docs/COMPONENTS.md) — presentational components
- [`docs/MONETIZATION.md`](docs/MONETIZATION.md) — Pro tier design and Polar
  runbook
- [`CHANGELOG.md`](CHANGELOG.md) — record of significant changes

_Note: `docs/*.md` still describe the Fresh architecture and are being updated
as part of the migration._

## Roadmap

- [ ] Complete the Astro migration and cut over hosting to Netlify
- [ ] Android release via TWA (Google Play)
- [ ] Custom domain

## License

AGPLv3 — see [LICENSE](LICENSE).
