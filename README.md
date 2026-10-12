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
  workers, push notifications, and add-to-home-screen on Android and desktop
- **Real-time updates** — changes from other members appear instantly via
  Supabase Realtime

## Tech stack

| Layer     | Tech                                                             |
| --------- | ---------------------------------------------------------------- |
| Frontend  | Astro 7 + Preact (+ Signals), server-rendered with islands       |
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
- **Realtime channel recovery** — if the Supabase Realtime WebSocket drops
  (token expiry, network blip, mobile sleep), the client automatically fetches a
  fresh token and resubscribes with backoff.
- **Security enforced in the database** — Postgres Row-Level Security isolates
  every group's data; the realtime channel can only deliver transactions from
  registries the authenticated user belongs to.

## Running locally

### Prerequisites

- [Node.js](https://nodejs.org) 22.12+ and npm 9.6.5+
- A [Supabase](https://supabase.com) project (free tier works) — or just a
  local Postgres for development

### Setup

```bash
git clone https://github.com/JS-Taiyou/alapar-fresh.git
cd alapar-fresh
git checkout migration/astro
npm install
cp .env.example .env   # fill in your Supabase + VAPID credentials
```

**Database.** Set `DATABASE_URL` to your Supabase pooler URL for the full
backend. When `DATABASE_URL` is unset, `src/lib/db.ts` falls back to a local
Postgres at `postgresql://alapar:alapar@localhost:5432/alapar` — spin one up
with `docker compose up db` (or use any local install) and apply `db/schema.sql`.
For the Supabase project itself, run the migrations in `db/` in the order
listed in [`docs/DATABASE.md`](docs/DATABASE.md#migrations).

### Commands

```bash
npm run dev        # dev server
npm run build      # production build (Netlify SSR function)
npm run preview    # preview the build
npm run check      # type-check (.astro + .ts via astro check)
npm run lint       # Oxlint via Vite+ (type-aware)
npm run fmt        # Oxfmt via Vite+ (use fmt:check to verify only)
npm test           # Vitest via Vite+ (passes while the suite is being ported)
```

## Testing

The original Deno test suite (balance engine, split math, route validation,
typed DB/Supabase stubs) is being ported from `deno test` to **Vitest** (run
with `npm test`, provided by Vite+) — it still lives on `main` for reference.
See [`MIGRATION.md`](MIGRATION.md).

## Documentation

- [`MIGRATION.md`](MIGRATION.md) — Fresh → Astro port map and remaining work
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture,
  directory structure, auth flow, caching, realtime
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
