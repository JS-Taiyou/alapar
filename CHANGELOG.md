# Changelog

All notable changes to this project are documented here. Dates are approximate.

---

## 2026-11-24 — Demo: several books + the real sidebar

`/demo` now mounts the real `DashboardShell` in demo mode instead of a
hand-rolled header + list, so it gets the sidebar and the book switcher.

- **Three books** in `data/demo.json` — _Depto Compartido_ (roommates), _Viaje
  a Oaxaca_ (a trip the demo user was invited to, so it shows a member's view),
  _Gastos de Pareja_ — with proper names for books and people; the demo user is
  signed in as "Ana Torres". Every book is a balanced ledger: one comes out
  negative, one positive.
- **`demo-data.ts`** builds each book's sidebar row, members and registry
  snapshot. An integrity test keeps the hand-written seed consistent: members
  only, shares add up, payment links stay inside the book, members' balances
  sum to zero.
- **Demo mode on the shell** (`isDemo`, `demoSnapshots`): switching books
  applies snapshots in memory, and the book being left is stashed so switching
  back restores it. No API, no IndexedDB, no cookie. The mount-time cache
  cleanup is skipped — run against the demo's registry ids, it would have
  dropped a signed-in visitor's real registry snapshots.
- **Sidebar in demo**: switching, collapse, rename, "Nuevo Libro" and terceros
  work locally; logout, invite, default split and delete are not offered.
- **Tour**: a "books" step opens both tours (now 6 and 9 steps), anchored to
  the book list on desktop and the menu button on mobile. The floating button
  lives in a bottom corner of the content column — bottom-right on phones —
  clear of the sidebar, its drawer and the FABs. In the installed PWA on a
  phone there is no menu button to anchor that step to, so it is a centered
  popover whose copy says to swipe. The settle-debt step's copy no longer
  promises that one click records the payment — the button fills in the amount.
- **Phone layout**: on `/demo` the menu button moves into the header, beside
  the balance (`MobileMenuButton`, plus `onMobileMenu`/`floatingTrigger` on the
  Sidebar), so nothing floats over the list and switching books never depends
  on scrolling. It stays hidden in the installed PWA, as the floating button
  always was — a swipe opens the drawer there. The regular dashboard keeps its
  floating button: its header also carries history, "Cortar" and the recurring
  button, and on a 360–375px phone a menu button beside the balance would
  leave the balance 95–136px — too little for a typical amount, which needs
  111–150px.
- Tests: seed-data integrity (8). 36 suites / 488 steps green.

---

## 2026-08-20 (b) — Public pricing page + in-app cancel + paywall funnel

Every upgrade CTA now funnels to a public **`/pricing`** page; Pro owners can
cancel (at period end) without leaving the app.

- **BUG FIX first**: `/api/billing` was missing from `FULL_STATE_PREFIXES` — the
  middleware never populated `ownerRegistryIds` on those paths, so
  checkout/portal owner checks 403'd for everyone. Also made `/api/locale`
  public (anonymous language switching on /demo and /pricing silently 401'd).
- **`/pricing` (public)**: Free vs Pro cards — free features rendered from
  `FREE_LIMITS` (can't drift from enforcement), "todo lo del plan gratuito,
  más:" on Pro, monthly/yearly switcher (SSR links). Prices fetched from Polar
  (`GET /v1/products/`, 10-min cache, `FALLBACK_PRICES` when unreachable) —
  dashboard stays the source of truth, price changes still never need a deploy.
  Session-aware CTAs: anonymous → signup/login with `?redirect=/pricing`
  round-trip; free owner → checkout link (or no-JS registry picker); Pro owner →
  "Activo" + cancel/reactivate/manage; member-only → ask-the-owner; no
  registries → create-first.
- **In-app cancel** (`POST /api/billing/cancel`): Polar
  `PATCH cancel_at_period_end` — Pro lasts through `current_period_end`,
  reversible via `undo`. New `db/add_subscription_cancel_flag.sql` column
  (mirror), persisted by the webhook too. Entitlements hardened: `canceled`
  - `current_period_end` in the future now resolves Pro (paid-through); matrix
    extracted to pure `resolveEffectivePlan` shared with the pricing page.
- **402 funnel**: new `Toaster` island (mounted in Sidebar) — paywalled failures
  inside forms (template cap in TransactionModal, registry cap in Sidebar) roll
  back and show a toast with a "Ver planes →" link; JoinButton shows the link
  under the group-full error; the no-JS registries fallback redirects to
  `/pricing`; `UpgradeButton` and `PaywallCard` CTAs point at `/pricing` (the
  old dead `?upgrade=` params are gone).
- Coupons: nothing to build — Polar-hosted checkout already accepts
  dashboard-configured discount codes.
- Tests: entitlements paid-through branches, cancel route (guards + fetch stub),
  pricing handler state matrix, webhook flag persistence. 64 suites / 501 steps
  green.

---

## 2026-08-20 — Money validation, transactional writes, UI hardening

Post-audit hardening pass (slop-police review): balance-integrity guarantees on
the server, DB transactions around multi-statement writes, and the interactive
layer's scaffolded-but-unwired states made real.

**Server (balance integrity)**:

- New `lib/transaction-validation.ts`: one shared parser for the transaction
  POST/PUT forms (previously ~90 lines duplicated per route). Enforces amount
  bounds, known `type`, installment ranges, split amounts summing to the
  transaction total (rounding tolerance scales with participant count), and
  linked payments not exceeding the pago. Deliberate behavior change: a fixed
  split that doesn't add up is now a 400 with a clear message instead of
  silently corrupting balances.
- `lib/db.ts` gains `withTransaction`; `createTransaction`, `updateTransaction`,
  `useInvitation`, `createRegistry`, `cloneTransactionForNextPeriod` and
  `batchCloneTransactions` now run their multi-statement sequences inside one DB
  transaction (transaction + payments + balance deltas can no longer half-apply;
  a failed join no longer burns an invite use). Batch cloning writes all cloned
  deltas as one batched INSERT instead of one query per row.
- `lib/server-cache.ts`: per-dataset presence — a spawn-candidates-first entry
  can no longer answer a transactions GET with an empty list, and registries
  with no recurring templates now actually hit the cache. Removed per-request
  production logs in the hot path.

**Client (wired states, shared scaffolds)**:

- New `components/Modal.tsx` adopted by all eight hand-rolled modals: Escape
  closes (which the demo tour's synthetic-Escape close depended on — the full
  tour was broken mid-way before), backdrop-close opt-out for the transaction
  editor, `role="dialog"`/`aria-modal`. The tour now completes end-to-end and
  detects its own teardown via driver.js `onDestroyed` instead of polling.
- TransactionModal: the `submitting` guard is real (double-submit, disabled
  buttons, "Guardando…" state), and optimistic writes roll back on server
  rejection — the pre-optimistic snapshots are restored and the modal reopens
  with the user's input intact. Same rollback for delete and for Sidebar
  rename/delete-registry; Cortar/RecurringSpawn failures now surface an error
  instead of reloading indistinguishably.
- `islands/shared-signals.ts` finally holds signals: `registrySwitch` and
  `entitiesChanged` replace the stringly-typed `CustomEvent` bus (payload typed
  once, both sides); registry switches now also forward linked payments. Deleted
  the dead `InviteManager` and `RealtimeSubscription` islands (283 lines,
  imported by nothing).
- `formatMoney()` / `initials()` extracted to `lib/format.ts` (33 + 11 inline
  copies removed); `SpawnCandidate` deduped into `lib/types.ts`.

**Follow-ups (same day, former PENDING.md items)**:

- Supabase server client is now a module-level singleton instead of a throwaway
  per request.
- `deleteEntity`'s in-use reference check uses JSONB containment
  (`split_json @> …`, GIN-indexed) instead of the fragile
  `split_json::text LIKE` string match.
- Carry-forward rejects `quantity > 1` on non-parcialidad sources with a 400
  instead of silently discarding the quantity.
- "Cortar" now archives the period and writes the carry-forward ajustes in ONE
  DB transaction — a crash mid-cut can no longer leave a period settled without
  its debts.
- `shouldSendPush` treats `lastPush = 0` explicitly as "never pushed" (always
  eligible) instead of relying on epoch-ms arithmetic.

**Tests / CI**:

- `test/fixtures/supabase_stub.ts` is structurally typed, so the test config
  type-checks for real; `deno task check` and CI run the suite WITHOUT
  `--no-check` again. New `test/fixtures/stub_compat.ts` fails `check:types` if
  the db stub drifts from `lib/db.ts`'s exports.
- New coverage: transaction-form validation matrix, cross-dataset cache
  isolation, the cut-with-ajustes happy path, and the carry-forward quantity
  contract. 62 suites / 473 steps green.

**Docs**: ROUTES/ISLANDS/COMPONENTS/ARCHITECTURE/BUSINESS_LOGIC/DATABASE/
MONETIZATION + both READMEs refreshed against the code (phantom
`/api/registries/switch` route removed, missing routes/components documented,
mangled ARCHITECTURE fences repaired, migration order in READMEs now points at
DATABASE.md's canonical list, rotting test-suite counters replaced with stable
claims).

---

## 2026-08-18 — Open signup (allowlist removed) + Pro tier merged

The app is public: any authenticated Google/email account can sign up.

- Removed the `allowed_emails` registration gate end-to-end: middleware checks
  (lightweight + full-state), `resolveUserState`'s is_email_allowed, the
  `/api/auth/check-email` endpoint (+ its test), the AuthForm pre-signup check,
  the login `?error=unauthorized` banner, the rate-limit and public-path
  entries, and the es/en i18n keys.
- `db/drop_allowed_emails.sql` drops the table. DEPLOY ORDER: run it AFTER the
  code deploy (the old code JOINs the table on every request); it's a no-op on
  fresh installs since `schema.sql` no longer creates it.
- Merged `feat/monetization-pro-tier` (Pro tier, see the 2026-08-14 entry below)
  into main alongside this change.

---

## 2026-08-14 — Pro tier with Polar billing

Paid registry plan (owner pays, whole group benefits). See
`docs/MONETIZATION.md` for the full design.

- **DB** (`db/add_billing.sql`): `registries.plan`
  (`free`|`pro`|`grandfathered`) — existing registries grandfathered to
  unlimited forever; `registry_subscriptions` Polar mirror (server-only, RLS
  with zero policies)
- **`lib/entitlements.ts`**: plan resolution (column + subscription + past-due
  grace) and free limits (2 owned registries, 4 members/registry, 3 active
  recurring templates, newest closed exercise only)
- **Enforcement** at 4 touchpoints, all returning `402 upgrade_required`:
  registry creation cap, join member cap (localized "group full" message),
  recurring/installment template cap, history depth (locked rows with upgrade
  CTA instead of silently hidden)
- **`lib/billing.ts`**: zero-dependency Polar REST client — Checkout Link
  builder, `syncCheckout`, customer-portal sessions, Standard Webhooks HMAC
  verifier (replay-protected, timing-safe), subscription-event upsert with 3-day
  cancellation grace
- **Routes**: `GET /api/billing/checkout` (owner-only 302), public
  `POST /api/webhooks/polar` (csrf-exempt, HMAC-verified),
  `POST /api/billing/portal`, `/billing/success` confirmation page
- **UI**: `UpgradeButton` island (monthly/yearly picker, non-owner hint),
  `PaywallCard` locked-history rows, sidebar CTA on free registries, billing
  i18n strings (es/en)
- **State**: middleware resolves the active registry's plan once per full-state
  request (`ctx.state.activeRegistryPlan`)
- Tests: plan matrix (incl. cancel-demotion, grace windows, grandfathered
  immunity), webhook signatures (tamper/replay/missing/multi-scheme), event
  upsert mapping, past_due grace, reference_id fallback. 61 suites / 457 steps
  green.

Post-review fixes (senior review, pre-merge):

- **Revenue leak**: canceled subscriptions kept Pro forever — the plan column
  was trusted unconditionally. `getRegistryPlan` now demotes `plan='pro'` to
  free when the subscription row is dead and grace has lapsed (grandfathered is
  immune by checking it first).
- **Portal always failed**: customer-session creation now sends the stored
  `polar_customer_id` (Polar requires a customer identifier).
- **Owned-registry cap punished loyal users**: the count now includes only
  effectively-free registries, so grandfathered/Pro groups don't consume it.
- Registry mapping accepts `reference_id` fallbacks (Polar's documented
  checkout-link params don't include `metadata[…]`); yearly preselect uses a
  dedicated `POLAR_CHECKOUT_LINK_YEARLY` when configured. Runbook requires a
  sandbox end-to-end check of which channel the webhook actually carries.
- Grace is also set on `past_due` (one failed charge ≠ instant cut).
- History personal totals computed for visible exercises only (removes an
  unbounded N+1 on free registries with long history).
- `GROUP_FULL` string sentinel replaced by a typed `GroupFullError`.

Type-checking restored to CI (second review follow-up):

- Fixed the `Uint8Array<ArrayBufferLike>` → `BufferSource` type error in
  `billing.ts` `base64Decode` (crypto.subtle rejected the widened type; the
  widening came from a bare `Uint8Array` annotation, not from `Uint8Array.from`
  as first assumed — comment documents the distinction).
- Root-caused why `--no-check` had hidden a whole class of errors: `db.ts`'s
  `query()` returned an unannotated `pool.query()` result whose row type varies
  by pg overload/version (`any[]`/`{}[]`), cascading implicit-any errors. Pinned
  to `QueryResult<Record<string, unknown>>` — version-independent and stable for
  every caller.
- New `deno.check.jsonc` + `deno task check:types`: a type-check-only config
  that omits tailwind/daisyui/vite (only vite.config.ts imports them, and the
  npm registry's corrupted `@tailwindcss/oxide-wasm32-wasi` metadata breaks any
  install resolving them). `deno install --no-lock` against this config succeeds
  on CI and gives `deno check` REAL npm type declarations — restoring full
  type-checking of everything except vite.config.ts TODAY, not "once the
  registry bug resolves". CI regains the step; `deno task check` includes it.
- Fixed the two latent errors that real typing then surfaced:
  `billing/success.tsx` (ctx.render data payload → `{ data }` object pattern)
  and `push.ts` (subscriptions row cast through unknown).

---

## 2026-08-12 — v1.0.0: Public launch + security hardening

First public release. A full security-hardening pass landed ahead of opening the
repo.

### Security — application layer

- **API authorization scoping**: exercise transactions/history verify registry
  membership (404 on foreign ids); carry-forward validates every item's registry
  and caps batches (≤100 items, quantity 1–60); default-split and invitation
  revoke are scoped to the target registry's owner; entities GET requires
  membership; transaction create/update validate payer/split participants and
  same-registry references; push subscribe requires an https endpoint and
  membership of the supplied registry
- **Owner-only destructive ops**: registry rename/delete and exercise close now
  require the owner role (previously any member)
- **Middleware**: CSRF exemptions removed entirely; `/api/auth/callback`
  requires a JSON body and validates tokens before setting cookies; the email
  allowlist is enforced before user creation on the very first request; security
  headers on every response (X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy); per-IP rate limit (20 req/min, 429) on invite-acceptance
  and auth endpoints
- **Auth/session**: browser Supabase clients run `persistSession: false`; Google
  OAuth moved to the PKCE flow (`/auth/callback` exchanges `?code=`);
  open-redirect params restricted to relative paths; logout revokes the session
  server-side and wipes client caches/storage; single-flight token refresh;
  access tokens are no longer serialized into dashboard HTML — the realtime
  client fetches `/api/auth/token` on subscribe
- **Service worker**: cache-first restricted to immutable static assets;
  `/api/*` and HTML navigations are network-only; caches purged on logout
- **Database (RLS)**: new `tighten_rls.sql` and `enable_realtime.sql`
  migrations; policies hardened — owner-only registry delete, per-command
  transaction policies (exercise-locked rows immutable), server-only
  audit_log/allowed_emails, member-scoped invitation reads, immutable user
  identity columns for client callers, `role` CHECK, case-insensitive email
  uniqueness
- **Misc**: invite codes use a CSPRNG and default to a 7-day expiry; max-uses
  increment is atomic; VAPID `aud` derived from the push endpoint origin per RFC
  8292 (Firefox/Safari push works); segment-aware public-path matching

### Repo hygiene

- Agent tooling and internal notes (`.agents/`, `.claude/`, `review/`,
  `mockups/`, `db/backups/`, `AGENTS.md`, `PENDING.md`, `skills-lock.json`) are
  untracked and don't ship with the repo
- Leftover debug logging removed from the dashboard route

### Tests

- Suite grew to 59 suites / 417 steps

---

## 2026-08-12 — Test suite, balance fix, demo tour, performance

### Test suite (4 phases, 47 suites / 339 steps)

Built a comprehensive unit + route-handler test suite from scratch. The project
had zero tests before this work.

**Infrastructure:**

- `deno.test.json` — test-only config that remaps `lib/db.ts` to a stub
- `test/fixtures/db_stub.ts` — controllable `query()` that records calls and
  returns canned rows
- `test/helpers.ts` — `makeCtx()` builder for route-handler tests, request
  builders

**Phase 1 — Pure logic** (`lib/calculations_test.ts`, `lib/format_test.ts`,
`lib/etag_test.ts`, `lib/routing_test.ts`): Balance math, split builders,
pairwise breakdown, input sanitizers, ETag hashing, routing rules.

**Phase 2 — Extracted pure modules** (`lib/rows_test.ts`, `lib/invite_test.ts`,
`lib/auth-cookies_test.ts`, `lib/encoding_test.ts`, `lib/server-cache_test.ts`):
Row mappers, invite-code generation, spawn-candidate filtering, cookie parsing
(the Deno Deploy comma-mashing edge case), base64url encoding, server cache
hit/miss/stale logic.

**Phase 3 — Route handler validation** (7 route test files): Pre-DB
validation/branching for default-split, transactions, entities, exercises,
registries, and invitations — using a fake `ctx` + the DB stub.

**Phase 4 — Deeper business logic** (`lib/realtime_test.ts`,
`lib/sql-builders_test.ts`, `lib/push_test.ts`): Invitation validation rules,
batch-insert placeholder math, UPDATE SET-clause builder, push cooldown gate,
realtime channel recovery policy.

### Pure module extraction

Extracted testable pure logic out of DB-coupled modules:

| New module            | Extracted from                 | Purpose                                                                          |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `lib/rows.ts`         | `store.ts`                     | Row mappers (`rowToUser`, `rowToTransaction`, etc.) + `rowToEnrichedTransaction` |
| `lib/invite.ts`       | `store.ts`                     | `generateInviteCode` + `filterSpawnCandidates` + `validateInvitation`            |
| `lib/auth-cookies.ts` | `supabase.ts`                  | `getCookie` (the comma-mashing cookie parser)                                    |
| `lib/encoding.ts`     | `notifications.ts` + `push.ts` | `base64url`, `concatUint8Arrays`, `encodeLength`                                 |
| `lib/routing.ts`      | `main.ts`                      | `needsFullState`, `isPublicPath`, `routeGuard`                                   |
| `lib/sql-builders.ts` | `store.ts`                     | `buildBatchPlaceholders`, `buildTransactionUpdateSets`                           |
| `lib/balances.ts`     | (new)                          | `computeDeltas` — the per-transaction balance delta source of truth              |

### Balance persistence (fixes 1-2 cent discrepancies)

Added a `transaction_balances` junction table that stores the signed,
rounded-to-cent balance delta for each user per transaction. Balance is now an
exact `NUMERIC(12,2)` SUM instead of a re-derivation from `split_json` every
time (which accumulated floating-point residue).

- `lib/balances.ts` — `computeDeltas(tx)`: pure function, single source of truth
- `db/add_transaction_balances.sql` — table creation + backfill migration
- All write paths (`createTransaction`, `updateTransaction`, `cloneTransaction`,
  `batchCloneTransactions`) now persist deltas
- `getBalanceFromDeltas()` — exact SUM query with try/catch fallback
- Display tolerance: `|balance| < $0.02` shows as `$0.00`
- Also fixes a latent payer-not-in-split bug

### Realtime channel recovery

- New `/api/auth/token` endpoint — returns the current (server-refreshed) access
  token for client-side realtime recovery
- `lib/realtime.ts` — on `CHANNEL_ERROR`/`TIMED_OUT`, fetches a fresh token and
  resubscribes with backoff (1s/2s/4s, max 3 attempts)
- `CLOSED` excluded from recovery (SDK fires it during normal lifecycle)
- Shared `rowToEnrichedTransaction` mapper eliminates duplicated `mapRow` in
  `TransactionList.tsx`

### Service worker improvements

- Replaced bare `"Offline"` text with a styled dark-themed Spanish fallback page
  ("No hay conexión" + Reintentar button)
- Non-HTML requests get a clean plain-text 503

### Performance

- `/` no longer runs full `resolveUserState` (saves 4 queries) — uses a single
  membership-existence check instead
- Dashboard shares one `getStamp()` between both cache lookups (saves 1 query)
- `/demo` skips auth + DB entirely (renders from static JSON)
- Dashboard `getAccessToken` replaced with canonical `getCookie` (fixes the Deno
  Deploy comma-mashing bug in the SSR path)

### Demo

- Guided tours via driver.js (MIT, zero-dependency)
- Two tours: "Tour Rápido" (5 steps, main page) and "Tour Completo" (10 steps,
  includes modal walkthrough with programmatic open/close)
- Styled popovers matching the app's dark palette
- Fixed negative `amount` values in `data/demo.json`
- Auth callback screen redesigned to use `AuthCardLayout` + branded spinner

### Routing refactor

- `lib/routing.ts` — `needsFullState`, `isPublicPath`, `routeGuard` extracted
  from `main.ts` as pure, testable functions
- `main.ts` calls these (behavior-preserving)

### Other

- `deno.json` — added `@std/assert`, `@std/testing`, `driver.js`; added `test`
  task; folded `deno test` into the `check` task
- `README.md` — added Testing section
- `.gitignore` — added `.zcode`, `PENDING.md`
