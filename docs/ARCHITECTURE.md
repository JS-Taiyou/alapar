# Architecture

## Overview

Alapar is a web-based expense-splitting application built with **Astro 7**
(server output, Netlify adapter), **React 19** for the interactive components,
and **PostgreSQL** (Supabase-hosted). It's a port of the
original Kotlin Multiplatform desktop/mobile app to a server-rendered web
application. (Parts of this document still describe the earlier Deno/Fresh
layout — file paths under `routes/` and `utils.ts` map to `src/pages/` and
`src/middleware.ts` in the Astro tree.)

## Tech Stack

| Technology      | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| Node + Astro 7  | Runtime + web framework (SSR, Netlify adapter)       |
| React 19        | Interactive hydrated components                      |
| PostgreSQL (pg) | Database via connection pool                         |
| Supabase Auth   | Authentication (email/password + Google OAuth, PKCE) |
| Tailwind CSS    | Styling                                              |

## Key Differences from Kotlin Version

| Aspect    | Kotlin Version                    | Web Version                                        |
| --------- | --------------------------------- | -------------------------------------------------- |
| Database  | Per-registry SQLite files         | Single PostgreSQL with `registry_id` on all tables |
| Auth      | Certificate-based (256-char hex)  | Supabase Auth (email/password + cookies)           |
| State     | In-memory Compose state           | Server-rendered + one hydrated React tree per page |
| UI        | Compose Multiplatform (Material3) | React/Tailwind (dark theme)                        |
| Platforms | Android, iOS, Desktop, Wasm       | Web only                                           |

## Application Flow

```
Browser Request
     │
     ▼
Fresh Middleware (utils.ts → State)
     │
     ├── No auth cookie → Public routes (/, /login, /signup, /join/[code])
     │
     └── Auth cookie valid → Resolve State (lightweight or full):
          │
          ├── Lightweight paths (/api/stamp, etc.):
          │    user + registries only (skip active registry details)
          │
          └── Full paths (/dashboard, /api/transactions, etc.):
               ├── user (from Supabase Auth ID → users table)
               ├── activeRegistry (from the in-memory active-registry map,
               │    set by POST /api/stamp — per-isolate, falls back to first)
               ├── registryUsers (real users in active registry via registry_members)
               ├── entities (third-parties from registries.entities_json)
               ├── participants (combined: registryUsers + entities)
               ├── registries (all registries user belongs to)
               └── isOwner (role check on active registry)
                    │
                    ▼
               Dashboard Layout (/_layout.tsx)
                    │
                    ├── Sidebar: Registry list + actions
                    ├── Header: BalanceBreakdown + Recurring + History + Cortar
                    └── TransactionList: Active expenses + CRUD modal
                         │
                         ├── Data loaded via server-cache (stamp check)
                         ├── Realtime via Supabase Postgres Changes
                         ├── Client cache in IndexedDB (snapshots)
                         └── Wake-up detection (visibilitychange + resume)
```

## Directory Structure

```
alapar-fresh/
├── routes/                    # Fresh file-based routing
│   ├── _app.tsx               # HTML shell (fonts, global styles)
│   ├── index.tsx              # Landing page
│   ├── login.tsx              # Login page
│   ├── signup.tsx             # Signup page
│   ├── forgot-password.tsx    # Password reset request (public)
│   ├── reset-password.tsx     # Set new password (public)
│   ├── auth/callback.tsx      # OAuth PKCE landing page
│   ├── join/[code].tsx        # Join registry via invite code
│   ├── registries/new.tsx     # Create new registry
│   ├── billing/success.tsx    # Polar checkout confirmation page
│   ├── dashboard/
│   │   ├── _layout.tsx        # Dashboard layout with Sidebar
│   │   ├── index.tsx          # Main dashboard (balance + transactions)
│   │   └── history/
│   │       ├── history.tsx    # Exercise history list
│   │       └── [id].tsx       # Exercise detail
│   ├── demo/index.tsx         # Static demo page (no auth/DB, guided tour)
│   └── api/                   # API endpoints
│       ├── auth/              # Token validation callback + logout + token
│       ├── billing/           # Polar checkout + customer portal
│       ├── webhooks/polar.ts  # HMAC-verified Polar webhook (public)
│       ├── dashboard.ts       # Dashboard data (ETag support)
│       ├── entities/          # Entity CRUD (terceros)
│       ├── exercises/         # Create exercise + carry-forward
│       ├── invitations/       # Create + list + revoke + join
│       ├── locale.ts          # UI language cookie
│       ├── registries/        # List/create + rename/delete + default-split
│       ├── stamp/[id].ts      # Lightweight registry timestamp check
│       ├── transactions/      # CRUD + disable-recurring
│       └── push/              # Web Push subscription endpoints
├── components/                # React components, hydrated per page
│   ├── auth/                  # AuthForm, AuthCallback, forgot/reset, join
│   ├── billing/               # BillingActions (pricing controls), retry
│   ├── dashboard/             # DashboardShell (single hydration root),
│   │   │                      #   dashboard-store.ts (useReducer store),
│   │   │                      #   Sidebar, TransactionList, TransactionModal,
│   │   │                      #   EntityManager, BalanceBreakdown, RecurringSpawn,
│   │   │                      #   DefaultSplitConfig, CortarButton, SearchBar,
│   │   │                      #   SidebarIsland.astro (standalone history mount)
│   ├── demo/                  # DemoApp (same reducer, static data), DemoTour
│   ├── history/               # ExerciseCard/PaywallCard/TransactionCard (.astro)
│   ├── ui/                    # Modal, ProBadge, LocaleToggle, UpgradeButton,
│   │                          #   Toaster + toast-store (useSyncExternalStore)
├── lib/
│   ├── db.ts                  # PostgreSQL pool + query + withTransaction
│   ├── supabase.ts            # Supabase client + auth helpers
│   ├── store.ts               # Data access layer (queries + business logic)
│   ├── transaction-validation.ts  # Shared POST/PUT form parser + money rules
│   ├── server-cache.ts        # In-memory server cache (stamp-based invalidation)
│   ├── cache.ts               # Client-side IndexedDB cache (registry snapshots)
│   ├── realtime.ts            # Supabase Realtime subscriptions + channel recovery
│   ├── push.ts                # Web Push notification sending (VAPID) + cooldown
│   ├── notifications.ts       # Client-side push subscription management
│   ├── calculations.ts        # Pure balance/split calculation functions
│   ├── balances.ts            # computeDeltas — per-transaction delta source of truth
│   ├── rows.ts                # Pure row mappers (rowToUser, rowToTransaction, etc.)
│   ├── invite.ts              # generateInviteCode + filterSpawnCandidates + validateInvitation
│   ├── auth-cookies.ts        # getCookie (handles Deno Deploy comma-mashing)
│   ├── auth-client.ts         # Client-side auth helpers (redirect-to-login, 401 detection)
│   ├── billing.ts             # Polar REST client + webhook HMAC verification
│   ├── entitlements.ts        # Plan resolution + free-tier limits (single source of truth)
│   ├── encoding.ts            # base64url, concatUint8Arrays, encodeLength
│   ├── i18n.ts + locales/     # es/en message catalogs, resolveLocale, t()
│   ├── routing.ts             # needsFullState, isPublicPath, routeGuard (pure)
│   ├── sql-builders.ts        # buildBatchPlaceholders, buildTransactionUpdateSets
│   ├── splits.ts              # Integer-cents split arithmetic (toCents, splitCents)
│   ├── format.ts              # formatMoney, initials + input sanitizers
│   ├── etag.ts                # generateETag
│   └── types.ts               # TypeScript interfaces
├── test/                      # Test infrastructure
│   ├── fixtures/db_stub.ts    # Controllable query() stub for route/store tests
│   ├── fixtures/supabase_stub.ts  # Structurally-typed @supabase/supabase-js stub
│   ├── fixtures/stub_compat.ts    # Compile-time db_stub ↔ lib/db.ts drift guard
│   └── helpers.ts             # makeCtx builder + request helpers
├── db/
│   ├── schema.sql             # Full PostgreSQL schema
│   ├── seed.sql               # Seed data
│   ├── add_registry_last_modified.sql
│   ├── add_related_transaction_id.sql
│   ├── add_transaction_payments.sql
│   ├── add_push_subscriptions.sql
│   ├── add_transaction_balances.sql  # Per-user balance deltas table + backfill
│   ├── add_billing.sql        # registries.plan + registry_subscriptions
│   ├── drop_allowed_emails.sql      # Open-signup cleanup
│   ├── enable_rls.sql         # Row-Level Security policies (re-runnable)
│   ├── tighten_rls.sql        # RLS hardening follow-up (idempotent)
│   └── enable_realtime.sql    # Publishes `transactions` via supabase_realtime
├── data/demo.json             # Static demo data (3 users, 7 transactions)
├── deno.json                  # Deno config (imports, tasks, compiler options)
├── deno.check.jsonc           # Type-check-only config (real npm types)
├── deno.test.json             # Test-only config (remaps db/supabase → stubs)
├── utils.ts                   # Fresh State definition + createDefine
└── CHANGELOG.md               # Record of significant changes
```

### Testing

Test files live alongside source as `*_test.ts`. The test config
(`deno.test.json`) remaps `lib/db.ts` and `@supabase/supabase-js` to stubs
(`test/fixtures/`) so tests run without `DATABASE_URL` or a live database — and
the suite is type-checked against those stubs (see
`test/fixtures/supabase_stub.ts` for the structural contract and
`test/fixtures/stub_compat.ts`, which fails `check:types` if `db_stub` drifts
from the real `lib/db.ts` exports).

```sh
deno task test    # run tests (uses deno.test.json with DB stub)
deno task check   # fmt + lint + type-check + tests
```

## Authentication Flow

**Email/password**:

1. User visits `/login` or `/signup`
2. Supabase client-side SDK handles auth (signUp / signInWithPassword) with
   `persistSession: false` — nothing auth-related reaches browser storage
3. On success, tokens are sent to `/api/auth/callback` (POST, JSON only)
4. Server validates the token pair with Supabase, then sets `sb-access-token`
   and `sb-refresh-token` as HttpOnly cookies (`Secure` in production —
   `COOKIE_SECURE`)
5. Subsequent requests: middleware reads cookie → validates with Supabase →
   resolves `State` (refreshing expired tokens single-flight, so concurrent
   requests share one refresh)
6. First-ever request from a new Supabase user: a `users` profile row is created
   (open signup — the app is public)
7. Logout: `/api/auth/logout` revokes the session server-side
   (`auth.admin.signOut`) and clears cookies; the client also wipes
   service-worker caches, IndexedDB snapshots, and any `sb-*` localStorage keys

**Google OAuth (PKCE)**:

1. `AuthForm` starts the OAuth flow with a PKCE client (`flowType: "pkce"`); the
   code verifier is the only value persisted to localStorage
2. Google redirects back to `/auth/callback?code=...`
3. `AuthCallback` exchanges the code for a session (`exchangeCodeForSession`),
   wipes the stored `sb-*` keys, then sends the tokens to `/api/auth/callback`
   as above
4. Redirect targets (`next`/`redirect` params) are validated to relative
   same-origin paths only — absolute URLs are rejected

## PWA Support

- **Manifest**: `/manifest.json` with standalone display mode
- **Service Worker**: `/sw.js` — cache-first only for immutable static assets
  (`/assets/*`, `/logo.svg`, `/favicon.ico`, `/manifest.json`,
  `/sw-register.js`). `/api/*` and HTML navigations are strictly network-only
  (never written to cache — authenticated responses must not be replayed), with
  a generic offline shell shown on network failure. On logout the client posts a
  `CLEAR_CACHES` message and the SW drops every cache
- **Viewport**: `maximum-scale=1.0, user-scalable=no` +
  `touch-action: manipulation` on body to prevent zoom interference with
  two-finger sidebar gesture
- **Push notifications**: Web Push via VAPID keys. Server sends push on
  transaction CUD (15s cooldown per registry). Client subscribes via
  `notifications.ts`
- **Install prompt**: Detected via `display-mode: standalone` media query

## Authorization

- **Open signup**: any authenticated Supabase account (Google OAuth or email +
  password) gets a `users` profile on first visit — the registration allowlist
  was removed when the app went public (`db/drop_allowed_emails.sql`)
- **Role-based access**: Registry membership tracked in `registry_members` with
  `owner` or `member` roles
- **Owner-only actions**: Creating/revoking invitations, configuring default
  split, renaming/deleting a registry, closing an exercise ("cortar"). Ownership
  is checked against the **target** registry (via `ctx.state.ownerRegistryIds`),
  not just the active one
- **Member gating**: `ctx.state.registries` only contains registries the user
  belongs to; API endpoints additionally validate any client-supplied
  `registryId`/exercise/invitation against membership (404/403 on foreign ids)
- **Middleware protections**: CSRF middleware (mutating requests must send a
  matching `Origin`) with a single documented exemption — the Polar webhook,
  whose authenticity is the Standard Webhooks HMAC signature rather than a
  session; security headers on every response (`X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`);
  per-IP rate limit (20 req/min → 429) on `/join`, `/api/invitations/join`,
  `/api/auth/callback`; public-path matching is segment-aware so
  `/joinville`-style prefixes can't slip through

## State Management

### Server-Side Cache (`lib/server-cache.ts`)

In-memory `Map<registryId, RegistryCache>` with stamp-based invalidation. Shared
across all users on the same server.

**What's cached**: Transaction lists and spawn candidates per registry
(identical for all users), each tracked by **presence**: a dataset nobody has
fetched is `undefined` and can never be served as a (possibly empty) hit, and an
empty candidate list caches like any other value.

**What's NOT cached**: Balance (pure function of `transactions + userId` —
computed live, no DB).

**Invalidation**:

- **Automatic**: On cache miss or TTL expiry (>15min), checks
  `registries.last_modified` stamp. If stamp matches cached value → cache hit (1
  stamp query only).
- **Eager**: `invalidateRegistry()` called on any transaction/entity/exercise
  CUD mutation.

**Flow per request**: `getCachedTransactions(registryId, fetcher)` → stamp check
→ cache hit = 0 extra queries, miss = run fetcher + cache.

### Client-Side Cache (`lib/cache.ts`)

IndexedDB-backed snapshot cache per registry. Enables instant registry switching
without page reload.

**Stored per registry**: transactions, balance, balanceEntries, users,
currentUserId, defaultSplit, lastModified.

**Registry switch flow**:

1. Read the IndexedDB snapshot for the target registry → apply it as an
   `APPLY_SNAPSHOT` action on the dashboard store
   (`components/dashboard/dashboard-store.ts`) → instant render in the shell
2. Background: POST `/api/stamp/{id}` (also marks the registry active
   server-side) → compare `lastModified`
3. If stamp matches → done (cache valid). If differs → fetch fresh data +
   re-apply

### Wake-Up Detection

On PWA resume from background/minimum/cold-start:

1. `visibilitychange` (visible), `resume`, `pageshow` events fire
2. If elapsed time > 30s since last active → stamp check + data refresh if stale
3. Realtime WebSocket reconnection via `resubscribe()`

### Realtime Updates

Supabase Postgres Changes subscription on `transactions` table filtered by
`registry_id`. Handles INSERT/UPDATE/DELETE events:

- Reducer actions in `TransactionList` (optimistic + realtime writes)
- Balance recalculation inside the reducer (`withBalances`) on every mutation
- Browser notifications for other users' inserts
- `resubscribe()` called on wake-up to reconnect dropped WebSocket

The channel's access token is **never serialized into page HTML** — the token
lives in an `HttpOnly` cookie, so `lib/realtime.ts` fetches it from
`/api/auth/token` when subscribing (and again, with backoff, when a channel
error suggests expiry). The realtime Supabase client runs with
`persistSession: false`; RLS policies on `transactions` gate what each
subscriber receives (see `db/enable_realtime.sql` — only `transactions` is
published).

### Server State (`utils.ts:State`)

Every request within an authenticated context has:

```typescript
interface State {
  user: User | null; // Single user identity (merged auth + profile)
  activeRegistry: Registry | null; // Currently selected registry
  registryUsers: User[]; // Real users in active registry (via registry_members)
  entities: Entity[]; // Third-party entities (from registries.entities_json)
  participants: Participant[]; // Combined: registryUsers + entities
  registries: Registry[]; // All registries for this user
  supabaseAuthId: string | null; // Supabase auth UUID
  accessToken: string | null; // Middleware-validated token (served by /api/auth/token)
  isOwner: boolean; // Is user owner of active registry
  ownerRegistryIds: Set<string>; // Registries the user owns (target-registry checks)
  locale: Locale; // UI language (cookie → Accept-Language → es)
  activeRegistryPlan: RegistryPlanInfo | null; // Active registry's plan (full-state paths)
}
```

**Key concept — `Participant`**: Both real users and entities share the base
interface `{ id, name, color }`. Calculations (balance, pairwise breakdown)
operate on `Participant[]` and don't care whether a participant is a real user
or an entity. The `entityIds: Set<string>` is passed separately to
TransactionList for "tercero" badges.

### Client State (React)

Interactive components are React 19 function components (`useState` locally).
The `/dashboard` page hydrates a single tree (`DashboardShell`) whose
`useReducer` store (`components/dashboard/dashboard-store.ts`) owns the shared
dashboard data; realtime events, registry switches and the transaction modal's
optimistic writes are typed actions, and balance recomputation happens inside
the reducer. The demo page runs the same reducer with static data. The upgrade
toasts are the one cross-cutting store: a framework-agnostic
subscribe/snapshot module (`components/ui/toast-store.ts`) bound with
`useSyncExternalStore`.

## Split JSON Format

Same format as Kotlin version, stored in `split_json` column (JSONB):

```json
{
  "splits": [
    { "userId": "uuid-1", "percentage": 50.0, "amount": 150.0 },
    { "userId": "uuid-2", "percentage": 50.0, "amount": 150.0 }
  ]
}
```

The `userId` can be either a `users.id` or an entity ID from
`registries.entities_json`.

## Split Modes

| Mode         | Behavior                                                         |
| ------------ | ---------------------------------------------------------------- |
| `auto`       | Equal division among all users, remainder assigned to first user |
| `percentage` | User-defined percentages, amounts calculated from total          |
| `fixed`      | User-defined amounts, percentages derived from total             |

## Transaction Types

| Type          | Spanish     | Behavior                                                   |
| ------------- | ----------- | ---------------------------------------------------------- |
| `unico`       | Único       | One-time expense                                           |
| `parcialidad` | Parcialidad | Installment: amount divided by `installmentTotal`          |
| `recurrente`  | Recurrente  | Recurring: clones itself on carry-forward                  |
| `pago`        | Pago        | Direct payment between users (affects balance differently) |
| `ajuste`      | Ajuste      | Balance adjustment (created during carry-forward)          |

## Balance Calculation

### Aggregate Balance (`calculateBalance`)

```
For each active transaction:
  If type is "pago" or "ajuste":
    If current user paid: balance += originalAmount
    Else if user is in split: balance -= originalAmount

  Else (expense):
    userSplit = user's share from split_json
    divisor = installmentTotal (if parcialidad) else 1
    perInstallmentTotal = originalAmount / divisor
    perInstallmentSplit = userSplit / divisor

    If current user paid:
      balance += (perInstallmentTotal - perInstallmentSplit)
    Else:
      balance -= perInstallmentSplit
```

**Positive balance** = others owe you. **Negative balance** = you owe others.

### Pairwise Breakdown (`calculatePairwiseBreakdown`)

For multi-user registries (3+ members), the aggregate balance alone doesn't tell
you _who_ you owe or who owes you. The pairwise breakdown solves this by
tracking a running net between the current user and each other participant:

```
For each active transaction:
  If type is "pago" or "ajuste":
    If current user paid:  net[recipient] += originalAmount
    If someone else paid:  net[payer] -= originalAmount

  Else (expense):
    divisor = installmentTotal (if parcialidad) else 1

    If current user paid:
      For each OTHER user in split:
        net[otherUser] += theirSplit.amount / divisor
    Else (someone else paid):
      net[payer] -= currentUserSplit.amount / divisor
```

Returns a sorted list of `BalanceBreakdownEntry` (positive = owed to you,
negative = you owe), filtered to entries with `|amount| >= $0.01`.

## Entities (Terceros)

Third-party participants (landlords, companies, etc.) that aren't real users.
Stored as JSON in `registries.entities_json` with auto-incrementing integer IDs.

**Key behaviors**:

- Appear in split dropdowns alongside real users
- Can be selected as "who paid" (user_paid)
- Marked with a "tercero" badge in the UI
- Managed by the owner via `EntityManager` island
- Cannot be deleted if referenced by active transactions

## Default Split

Registry owners can configure custom default split percentages that pre-fill
when creating new transactions.

**Key behaviors**:

- Stored as JSON in `registries.default_split_json` with
  `default_split_member_count`
- Auto-invalidates when member count changes (reverts to equal split)
- Only configurable by the registry owner
- Pre-fills percentage mode in the transaction modal

## "Cortar" (Cut/Settle)

When there are active transactions (no other prerequisite — unsettled balances
are not a blocker):

1. Computes the pairwise debts from the active transactions
2. Creates an `exercise` record spanning earliest active transaction date to now
3. All active transactions get their `exercise_id` set (archived)
4. Outstanding debts carry into the new period as `ajuste` transactions, so
   nothing is lost
5. Recurring/installment transactions that were archived become candidates for
   carry-forward

## Carry-Forward (Recurring Spawn)

After a cut, recurring expenses and incomplete installments can be cloned into
the new period:

- **Recurrente**: Creates a fresh clone with `exercise_id = NULL`
- **Parcialidad**: Creates clone with `installmentCurrent` incremented by
  specified quantity
- Users can choose which items to include and disable ones no longer needed
