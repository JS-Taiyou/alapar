# Routes Documentation

## Overview

Routes follow Fresh 2 conventions. Files use `define.page()`, `define.layout()`,
and `define.handlers()`. Authenticated routes access shared `State` from
`utils.ts`.

---

## Public Routes

### `/` — Home Page

**File**: `routes/index.tsx`

Landing page with two action cards:

- **Nuevo registro** — Links to `/registries/new` to create a new expense group
- **Unirme a registro** — Contains `JoinCodeForm` island for entering an invite
  code

No authentication required.

### `/login` — Login Page

**File**: `routes/login.tsx`

Displays `AuthForm` island in `mode="login"`.

Passes `supabaseUrl` and `supabaseAnonKey` as props to the island for
client-side Supabase auth.

### `/signup` — Signup Page

**File**: `routes/signup.tsx`

Displays `AuthForm` island in `mode="signup"`. Same pattern as login — client
handles signup via Supabase, then calls `/api/auth/callback` to set server
cookies.

### `/forgot-password` — Password Reset Request

**File**: `routes/forgot-password.tsx`

Public page rendering the `ForgotPassword` island inside `AuthCardLayout`.
Client-side Supabase `resetPasswordForEmail` — no server state involved.

### `/reset-password` — Set New Password

**File**: `routes/reset-password.tsx`

Public page rendering the `ResetPassword` island inside `AuthCardLayout`.
Receives the Supabase recovery-session redirect (after the email link); the
island sets the session in memory only, updates the password via `updateUser`,
and points the user back to `/login`.

### `/auth/callback` — OAuth Landing Page

**File**: `routes/auth/callback.tsx`

Renders the `AuthCallback` island for the Google PKCE flow: reads `?code=` plus
a validated relative `next` param (open-redirect guard — absolute paths fall
back to `/dashboard`), exchanges the code, then POSTs tokens to
`/api/auth/callback`.

### `/pricing` — Public Pricing Page

**File**: `routes/pricing.tsx`

Public (no auth). The funnel target for every upgrade CTA in the app. Two tier
cards — Gratis (features rendered from `FREE_LIMITS`, so the page can't drift
from enforcement) and Pro ("todo lo del plan gratuito, más:") with a
monthly/yearly switcher (SSR `?interval=` links). Prices are fetched from Polar
(`GET /v1/products/`, cached 10 min; dashboard stays the source of truth) with
static fallbacks when unreachable.

Session-aware CTAs: anonymous → signup/login with `?redirect=/pricing`
round-trip (a subscription requires an account that owns a registry); logged-in
owner of free registries → direct checkout link (ONE per-user subscription
unlocks every registry they own); live subscriber → "Activo" badge plus discrete
cancel/reactivate (`BillingActions` island) and portal link; member-only →
ask-the-owner hint; no registries → create-first CTA.

### `/demo` — Guided Demo

**File**: `src/pages/demo/index.astro`

Public, no auth and no DB: the real dashboard (`DashboardShell` in demo mode)
rendered from static `data/demo.json` — three books (roommates, a trip with
friends, a couple) shared between six people. The sidebar lists the books and
switching between them happens in memory: no API, no IndexedDB, no cookie (on
phones the menu button sits in the header, beside the balance).
What the sidebar offers there works locally (switch, rename, "Nuevo Libro",
terceros) and resets on reload; what needs a session is not rendered (logout,
invite, default split). Includes the `DemoTour` island (driver.js quick/full
tours — the full tour opens and closes the real transaction modal via Escape)
and a `LocaleToggle`.

### `/join/[code]` — Join Registry via Invitation

**File**: `routes/join/[code].tsx`

**Handler (GET)**: Looks up invitation by URL parameter `code` via
`getInvitationByCode()`.

**Page rendering**:

- If invitation not found → error page with "Invitación no encontrada"
- If invitation is expired, revoked, or maxed → error message
- If user is logged in → shows `JoinButton` island to accept invite
- If user is not logged in → links to `/login` and `/signup`

Rate-limited: 20 requests/minute per IP (429 beyond that).

### `/registries/new` — New Registry Form

**File**: `routes/registries/new.tsx`

Simple HTML form that POSTs to `/api/registries`. Single field: registry name.
No island needed — standard form submission.

---

## Dashboard Routes (Authenticated)

All under `routes/dashboard/`. Protected by shared layout.

### `/dashboard/_layout.tsx` — Dashboard Layout

**File**: `routes/dashboard/_layout.tsx`

Wraps all dashboard routes in a sidebar + content layout:

- Renders `Sidebar` island with user info, registry list, entities, default
  split, invite button
- Passes `ctx.state.registries`, `activeRegistry`, `isOwner`, `entities`,
  `registryUsers`, `defaultSplit` as props
- Computes `userInitials` from user name
- Fetches transaction counts per registry for deletable registry detection

### `/dashboard` — Main Dashboard

**File**: `routes/dashboard/index.tsx`

**Handler (GET)**:

1. Gets `userId` directly from `ctx.state.user.id` (no mapping needed — single
   user ID)
2. Fetches active transactions via server cache (`getCachedTransactions`) —
   stamp check avoids DB query if cached
3. Calculates balance (`calculateBalance`) for the current user (pure function,
   no DB)
4. Fetches spawn candidates via server cache (`getCachedSpawnCandidates`)
5. Enriches each transaction with `paidByUser` (looked up from `participants`
   map)
6. Computes pairwise balance breakdown (`calculatePairwiseBreakdown`) using
   `participants` array
7. Passes `lastModified` from active registry for client-side cache coordination

**Page rendering**:

- Header with `BalanceBreakdown` island (clickable total balance, popover for
  per-person breakdown)
- `RecurringSpawn` island (only visible if there are candidates)
- History link → `/dashboard/history`
- `CortarButton` island (only active when transactions exist)
- `TransactionList` island with enriched transactions, participants, current
  user ID, default split, and entity IDs

### `/dashboard/history` — Exercise History

**File**: `routes/dashboard/history.tsx`

**Handler (GET)**:

1. Fetches all exercises for active registry (`getExercises`)
2. Groups by year (descending)
3. Returns grouped exercises, year list, and flat exercise array

**Page rendering**:

- Back button → `/dashboard`
- `SearchBar` island (client-side filter: hides non-matching exercise cards via
  the `filterSelector` prop, `[data-exercise-card]`)
- Exercises grouped by year with `ExerciseCard` components
- Empty state if no exercises exist

### `/dashboard/history/[id]` — Exercise Detail

**File**: `routes/dashboard/history/[id].tsx`

**Handler (GET)**:

1. Fetches exercise by ID (`getExerciseById`)
2. Verifies the exercise belongs to one of the caller's registries — 404
   otherwise (an exercise from a foreign registry is indistinguishable from
   "does not exist")
3. Fetches all transactions in that exercise (`getTransactionsByExercise`)
4. Enriches each with `paidByUser` (looked up from `participants` map)

**Page rendering**:

- Exercise title: "Corte {month} {year}" in Spanish
- Transaction count and personal total amount
- List of `TransactionCard` components (server-rendered, not interactive)
- "Corte no encontrado" fallback if exercise doesn't exist

---

## API Routes

### `/api/dashboard` — Dashboard Data (GET)

**File**: `routes/api/dashboard.ts`

Returns all dashboard data as JSON with ETag support. Uses server cache for
transaction and spawn candidate queries. Balance is computed live (pure
function).

Returns:
`{ transactions, users, balance, balanceEntries, spawnCandidates, defaultSplit, entityIds }`

### `/api/stamp/[id]` — Registry Timestamp (POST)

**File**: `routes/api/stamp/[id].ts`

Lightweight endpoint. **POST-only** — GET returns 405 with `Allow: POST`.
Validates user membership (403 otherwise), returns `{ lastModified }` ISO string
from `registries.last_modified`. Used by client-side cache to detect stale data
without full dashboard fetch. As a side effect, the POST also marks the registry
as the caller's active registry server-side (one reason it isn't a GET).

Handled by the middleware's lightweight path (no `resolveUserState` — only basic
auth + user lookup).

### `/api/auth/callback` — Auth Callback (POST)

**File**: `routes/api/auth/callback.ts`

Receives Supabase `accessToken` and `refreshToken` in a JSON body
(`Content-Type: application/json` required — 400 otherwise). The token pair is
validated with Supabase (`auth.getUser`) **before** any cookie is set — invalid
tokens get a 401. Sets them as `HttpOnly` cookies (`sb-access-token`,
`sb-refresh-token`).

- Access token cookie: 7-day expiry
- Refresh token cookie: 30-day expiry
- `Secure` flag on both in production (see `COOKIE_SECURE` in `.env.example`)

Called by `AuthForm` island after successful Supabase login/signup, and by
`AuthCallback` after the OAuth PKCE code exchange. Rate-limited (20 req/min per
IP).

### `/api/auth/token` — Current Access Token (GET)

**File**: `routes/api/auth/token.ts`

Returns `{ accessToken }` — the token the middleware already validated (and
refreshed, if needed) for this request, served from `ctx.state.accessToken`
instead of re-validating with possibly-spent cookies. 401 when unauthenticated.
This is the seam the realtime client (`lib/realtime.ts`) uses to authenticate
the Supabase channel, since the token lives in an `HttpOnly` cookie and is never
serialized into page HTML.

### `/api/auth/logout` — Logout (POST)

**File**: `routes/api/auth/logout.ts`

Revokes the session server-side (`auth.admin.signOut`, best-effort — also
invalidates refresh tokens), clears auth cookies, and redirects to `/login`
(returns JSON `{ ok: true }` for `Accept: application/json`). The client
additionally wipes service-worker caches, IndexedDB snapshots, and any `sb-*`
localStorage keys before leaving (see `Sidebar` island).

### `/api/registries` — List/Create Registries (GET/POST)

**File**: `routes/api/registries/index.ts`

**GET**: Returns the caller's registries + active registry id as JSON.

**POST**: Receives a `name` (form data or JSON — the `Accept`/`Content-Type`
header decides). `createRegistry(name, userId)` inserts the registry and the
owner membership in one DB transaction. Free-plan cap on **owned effectively-
free** registries (2) enforced first — JSON clients get `402 upgrade_required`,
the form fallback redirects to `/pricing`. Returns `{ registry }` (JSON) or
redirects to `/dashboard` (form).

### `/api/registries/[id]` — Rename/Delete Registry

**File**: `routes/api/registries/[id].ts`

**PATCH**: Renames registry. **Owner-only** (403 for plain members). Returns
updated registry JSON.

**DELETE**: **Owner-only** (checked in middleware state and re-checked in SQL).
Deletes registry only if it has zero transactions (409 otherwise). Redirects
remaining registries.

### `/api/registries/default-split` — Configure Default Split (POST/DELETE)

**File**: `routes/api/registries/default-split.ts`

**POST**: Owner-only — requires ownership of the **target** registry from the
body (not just the active one; 403 otherwise). Receives JSON
`{ splits: [{ userId, percentage }], registryId }`. Validates that all userIds
are participants (users or entities) of that registry and that percentages sum
to 100%. Saves to `registries.default_split_json`.

**DELETE**: Same target-registry ownership check. Clears default split for the
registry.

### `/api/entities` — Entity CRUD

**File**: `routes/api/entities/index.ts`

**GET**: Returns all entities for a registry (query param `registryId`, defaults
to the active registry). Requires membership of that registry — 403 otherwise,
so foreign registry contents can't leak.

**POST**: Creates a new entity in `registries.entities_json` with a random UUID
id and default color. Invalidates server cache.

**File**: `routes/api/entities/[id].ts`

**PUT**: Updates entity name/color. Invalidates server cache.

**DELETE**: Deletes entity only if it has no active transactions (checks
`user_paid` and `split_json`). Invalidates server cache.

### `/api/transactions` — List/Create Transactions

**File**: `routes/api/transactions/index.ts`

**GET**: Returns active transactions for the registry via server cache. Supports
ETag/304.

**POST**: Creates transaction via `createTransaction()` (INSERT + linked
payments + balance deltas in one DB transaction). The form is parsed by the
shared validator (`lib/transaction-validation.ts`): amount bounds/type/
installment ranges, split entries must be well-formed, split amounts must sum to
the transaction total (small rounding tolerance), and linked payments may not
exceed the pago amount. Cross-reference validation: `userPaid` and every split
`userId` must be participants (users or entities) of the target registry, and
`relatedTransactionId`/payment `expenseIds` must resolve to transactions in that
same registry (400 otherwise). Invalidates server cache for the registry. Sends
Web Push notification to other registry members.

### `/api/transactions/[id]` — Update/Delete Transaction

**File**: `routes/api/transactions/[id].ts`

**PUT**: Updates transaction fields from form data, parsed by the same shared
validator with the same participant/reference validation as POST. Invalidates
server cache for the registry. Sends Web Push.

**DELETE**: Deletes transaction by ID. Invalidates server cache. Returns 204 on
success, 404 if not found. Sends Web Push.

### `/api/transactions/disable-recurring` — Disable Recurring (POST)

**File**: `routes/api/transactions/disable-recurring.ts`

Receives JSON `{ id }`. Sets `recurring_disabled = true` on the transaction.
Used by `RecurringSpawn` island to permanently exclude a recurring/installment
from future carry-forward.

### `/api/exercises` — Create Exercise / Cut (POST)

**File**: `routes/api/exercises/index.ts`

**Owner-only** — closing an exercise is destructive; the caller must own the
target registry (403 otherwise, for the active registry too, not just when a
different one is requested).

Creates an exercise (cut) for the active registry:

1. Checks for active transactions
2. Computes pairwise debts using `calculateFullPairwiseBalances()` with
   `participants`
3. Creates exercise record, archives all active transactions
4. Creates `ajuste` transactions for any outstanding debts to carry into next
   period — steps 3–4 run in ONE DB transaction, so a mid-cut failure rolls the
   archive back instead of leaving a settled-without-debts period
5. Invalidates server cache for the registry
6. Redirects to `/dashboard`

### `/api/exercises/[id]/transactions` — Exercise Transactions (GET)

**File**: `routes/api/exercises/[id]/transactions.ts`

Returns the transactions of an exercise. Membership-scoped: an exercise outside
the caller's registries resolves to 404 (no existence leak), and the transaction
query is scoped the same way in SQL as defense in depth.

### `/api/exercises/carry-forward` — Carry Forward Recurring (POST)

**File**: `routes/api/exercises/carry-forward.ts`

Receives JSON `{ items: [{ id, quantity? }] }`. Validates **every** item: all
ids must exist (404 otherwise) and every source transaction's registry must
belong to the caller (403 otherwise). Batch caps: at most 100 items, integer
`quantity` between 1 and 60 — and `quantity > 1` is only valid for `parcialidad`
sources (400 otherwise; recurrente items clone exactly once). For each item:

- If parcialidad: clones `quantity` times, incrementing `installmentCurrent`
- If recurrente: clones once
- Each clone gets `exercise_id = NULL` (active in new period)

### `/api/invitations` — Create Invitation (POST)

**File**: `routes/api/invitations/index.ts`

Owner-only. Receives JSON `{ registryId, expiresAt?, maxUses? }`. Generates an
8-character alphanumeric code with `crypto.getRandomValues` (CSPRNG). When no
`expiresAt` is given (e.g. invitations created from the UI), the expiry defaults
to 7 days. Creates invitation record + audit log entry. Returns
`{ id, code, expiresAt }`.

### `/api/invitations/join` — Join via Invitation (POST)

**File**: `routes/api/invitations/join.ts`

Receives JSON `{ code }`. Validates invitation (not expired, not revoked, under
max uses). If user is already a member, just sets active registry. Otherwise:

- Adds user to `registry_members` as `member`
- Increments invitation's `current_uses` — atomically: the UPDATE itself
  enforces not-revoked and under-max-uses, so concurrent joins can't overshoot
- Sets as active registry
- Invalidates default split if member count changed
- Logs to audit log

Returns `{ registryId }` or error. Rate-limited (20 req/min per IP), as is the
`/join/[code]` page.

### `/api/invitations/list` — List Invitations (GET)

**File**: `routes/api/invitations/list.ts`

Owner-only. Query param `registryId`. Returns array of invitations for the
registry.

### `/api/invitations/[id]/revoke` — Revoke Invitation (POST)

**File**: `routes/api/invitations/[id]/revoke.ts`

Owner-only, scoped in SQL: the revoke only lands when the caller owns the
invitation's registry (regardless of which registry is active) — a foreign or
unknown id no-ops and returns 404. Sets `revoked_at = now()` on the invitation.
Logs to audit log.

### `/api/locale` — UI Language (POST)

**File**: `routes/api/locale.ts`

Receives JSON `{ locale: "es" | "en" }` (anything non-`en` resolves to `es`) and
sets the year-long `alapar-locale` cookie. The client reloads after the response
so SSR re-renders in the new language. Locale for any request is resolved in
`ctx.state.locale` (cookie → `Accept-Language` → `es`). Public path — anonymous
visitors can switch the language on `/demo` and `/pricing`.

### `/api/push/subscribe` — Push Subscription (POST)

**File**: `routes/api/push/subscribe.ts`

Receives JSON `{ endpoint, keys: { p256dh, auth }, registryId? }`. Validates
that `endpoint` is a genuine `https:` push-service URL and, when `registryId` is
supplied, that the caller is a member of it (403 otherwise). Upserts on
`endpoint` conflict — the row's `user_id`/`registry_id` are re-assigned so a
re-subscribed endpoint can't keep delivering to a previous owner.

### `/api/push/unsubscribe` — Remove Push Subscription (POST)

**File**: `routes/api/push/unsubscribe.ts`

Deletes the caller's push subscription by endpoint.

### `/api/push/public-key` — VAPID Public Key (GET)

**File**: `routes/api/push/public-key.ts`

Returns the VAPID public key the client needs to subscribe. The server signs
push JWTs with `aud` derived from each subscription's endpoint origin (RFC
8292), so non-FCM push services (Firefox, Safari) work.

## Billing (Pro tier)

### `/api/billing/checkout` — Start Polar Checkout (GET)

**File**: `routes/api/billing/checkout.ts`

Authenticated (session user — nothing forgeable in the query). Query:
`interval=monthly|yearly`. 302-redirects to the dashboard-configured Polar
Checkout Link with `metadata[user_id]`/`reference_id`/`locale`/`theme` appended
so the webhook can map the subscription back to the subscribing USER — one
subscription unlocks every registry they own. 503 when billing env is not
configured.

### `/api/webhooks/polar` — Polar Webhook (POST, public)

**File**: `routes/api/webhooks/polar.ts`

Public endpoint (public-path list + csrf-exempt — authenticity comes from the
Standard Webhooks HMAC signature). Handles `subscription.*` events: upserts
`registry_subscriptions`, sets a 3-day `grace_until` on cancel/revoke, flips
`registries.plan` on activation. Invalid signature → 401 (no retry); handler
error → 500 (Polar retries).

### `/api/billing/cancel` — Cancel at Period End (POST)

**File**: `routes/api/billing/cancel.ts`

Authenticated (acts on the CURRENT user's subscription — subscriptions are
per-user). Body: `{ undo?: boolean }`. Calls Polar
`PATCH /v1/subscriptions/{id}` with `cancel_at_period_end` — the subscription
(and Pro, on ALL the subscriber's registries) stays active until
`current_period_end`; `undo` reactivates. On Polar success the mirror's
`cancel_at_period_end` flag is updated locally (the webhook stays authoritative
for everything else). 404 when the user has no subscription; 502 when Polar
rejects the call (mirror untouched); 503 when billing isn't configured. Used by
the `BillingActions` island on `/pricing`.

### `/api/billing/portal` — Customer Portal Session (POST)

**File**: `routes/api/billing/portal.ts`

Authenticated (session user). No body. Creates a Polar customer-session and
returns `{ url }` for cancel/payment-method self-service.

### `/billing/success` — Checkout Success Page (GET, public)

**File**: `routes/billing/success.tsx`

Polar redirects here with `?checkout_id=…`. Calls `syncCheckout` for instant Pro
confirmation (webhooks can lag seconds); shows a pending state when the payment
is still processing.
