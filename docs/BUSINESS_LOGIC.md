# Business Logic

## Core Concepts

### Registry

A group of people sharing expenses. Each registry is an isolated scope — users,
transactions, exercises, and invitations all belong to one registry.

### Transaction Types

| Type          | Description                               | Balance Effect                              |
| ------------- | ----------------------------------------- | ------------------------------------------- |
| `unico`       | One-time expense (e.g., dinner)           | Standard split balance                      |
| `parcialidad` | Installment (e.g., laptop over 12 months) | Per-installment portion only                |
| `recurrente`  | Recurring expense (e.g., monthly rent)    | Full amount, clones on carry-forward        |
| `pago`        | Direct payment between users              | Special: payer +$amount, recipient -$amount |

### Split Modes

Users choose how to divide each expense:

1. **Auto** — Equal split among all members. A cent that cannot be divided is
   dealt by the book's line (below).
2. **Percentage** — Each user gets a custom percentage. Sum must equal 100%.
   Amounts are calculated, then dealt to whole cents by the book's line.
3. **Fixed** — Each user gets a custom amount. Sum must equal total. Percentages
   are derived. Amounts are kept as typed.

For 2-user registries, editing one user's value auto-complements the other
(e.g., enter 30% → other becomes 70%).

### Leftover cents (`lib/splits.ts`, `resolveTransactionSplit`)

A cent cannot be divided, and the app never keeps fractions of one. **Auto**
and **Porcentaje** shares are dealt by the server, inside the transaction that
saves the expense, against a line each book keeps (`registries.remainder_queue`):

1. Every share is rounded down. The cents left over go to the largest
   remainders, one each.
2. A tie — an even split, 50/50 — is settled by the line: whoever is first
   takes the cent. The line only holds members who have taken one, so a member
   who never has goes before any of them.
3. Whoever gained a cent that way takes a turn and moves to the back (so does
   whoever gave one back when the floors add up to too much). Among n members,
   whoever took a cent waits exactly n − 1 turns, in an order the book keeps
   for good.
4. In **Porcentaje**, the member holding the odd hundredth of an even split
   (33.34 among 33.33s) takes a turn too, even on an amount where every share
   is exact: that hundredth is $0.15 more of a $1,500 expense.

$10.11 at 50/50 is 5.06 / 5.05, then 5.05 / 5.06 the next time. $10.01 among
three leaves two cents, so two members take one each and every member carries
a cent in two expenses out of three.

The form shows the same deal the server will make, from the line delivered with
the dashboard and with every save's answer; the server's split is the one that
is saved. **Monto Fijo** is the user's own cents and is never dealt.

- **Edits**: a split left alone keeps its cents and its turn. Only a split that
  changed is dealt again, against the line as it stands then.
- **Deleting** an expense never rewinds the line.
- **Instalments and recurring expenses** take a turn from the line when each
  period is created, with the split that expense has at that moment — not a
  turn of their own series, so a split that changes in between is simply dealt
  as it stands.
- **Old rows** carry no mode. An even split among them is dealt as Auto, the
  way the form opens it; anything else is copied as it stands.

### Server-side validation (`lib/transaction-validation.ts`)

The create/update routes parse the form with one shared validator, so neither
path can drift. Beyond field presence, it enforces the money rules that keep
balances trustworthy (whatever passes here is persisted and summed verbatim into
`transaction_balances`):

- Amounts must be finite, positive, and within a sane ceiling; `type` must be
  one of the five known values; installments are integers in range
  (`installmentCurrent` ≤ `installmentTotal`)
- For expenses, split amounts must sum to the transaction total within a small
  rounding tolerance (scales with participant count — the client's
  percentage/fixed builders round each share independently). A split the
  server deals then comes out at the total to the cent.
- `splitMode`, when sent, is one of `auto`, `percentage`, `fixed`
- Linked payment allocations may not exceed the pago's amount
- Payer and every split `userId` must be participants of the target registry,
  and every referenced transaction must live in that same registry

**Write integrity**: transaction INSERT + linked payments + balance deltas, the
update equivalent, registry creation, invitation joins, and batch cloning all
run inside `withTransaction` (`lib/db.ts`) — a failure mid-sequence rolls the
whole unit back instead of leaving balances drifted from transactions. The
book's line is held under a row lock for the whole unit, so two saves racing
each other cannot hand the same turn to two people.

---

## Balance Calculation

The balance answers: "How much is this person owed (positive) or owes
(negative)?"

### For Regular Expenses (unico, parcialidad, recurrente)

```
For each active transaction where user is in split:
  userSplit = user's amount from split_json
  divisor = installmentTotal (if parcialidad) else 1
  perInstallmentTotal = originalAmount / divisor
  perInstallmentSplit = userSplit / divisor

  IF userPaid == currentUser:
    balance += (perInstallmentTotal - perInstallmentSplit)
    // "Others owe me for their share"
  ELSE:
    balance -= perInstallmentSplit
    // "I owe my share to whoever paid"
```

**Why `total - userShare` when user paid?**

- User pays $100 for a $50 share
- User's pocket: -$100
- Fair share: $50
- Others collectively owe: $50 = $100 - $50 → positive (money flowing to user)

### For Payments (pago)

```
IF currentUser == userPaid:
  balance += originalAmount     // "I paid someone, reducing their debt to me"
ELSE IF currentUser in split:
  balance -= originalAmount     // "Someone paid me, reducing my debt to them"
```

---

## Pairwise Balance Breakdown

In multi-user registries (3+ members), the aggregate balance doesn't reveal
_who_ you owe or who owes you. The pairwise breakdown
(`calculatePairwiseBreakdown`) tracks a running net between the current user and
each other member.

### Algorithm

```
Initialize net[otherUser] = 0 for each non-self user

For each active transaction:
  IF type is "pago":
    IF currentUser paid:
      net[recipient] += originalAmount
    ELSE IF currentUser is in split:
      net[payer] -= originalAmount

  ELSE (expense):
    divisor = installmentTotal (if parcialidad) else 1
    currentUserSplit = user's share from split_json

    IF currentUser paid:
      For each OTHER user in split:
        net[otherUser] += otherUser.split.amount / divisor
    ELSE (someone else paid):
      net[payer] -= currentUserSplit.amount / divisor

Filter: only keep entries where |amount| >= $0.01
Sort: highest amount first (creditors before debtors)
```

### Where It's Used

| Location                                                | Purpose                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Dashboard header** (`BalanceBreakdown` island)        | Clickable balance opens popover with "Te debe" / "Le debes" per person (only when 3+ users)        |
| **Payment modal** (`TransactionList` island, pago mode) | SALDO column shows per-user balance so the user knows who to pay and how much (only when 3+ users) |

### Example

Registry with 4 users: Alice (self), Bob, Carol, Dave.

Active transactions:

- Alice paid dinner $120 (split 4 ways: $30 each)
- Bob paid groceries $80 (split 4 ways: $20 each)
- Carol paid Uber $40 (split 4 ways: $10 each)

Alice's pairwise breakdown:

| Person | Net  | Display          |
| ------ | ---- | ---------------- |
| Bob    | +$10 | "Te debe $10.00" |
| Carol  | +$20 | "Te debe $20.00" |
| Dave   | +$30 | "Te debe $30.00" |

Alice's aggregate balance: $60.00 (sum of all pairwise nets).

---

## Cortar (Cut/Settle)

The cut operation archives all active expenses into a historical period.
**Owner-only** — closing an exercise is a destructive operation and the server
rejects it for plain members (403).

**Prerequisites**: None — unsettled balances are not a blocker. The cut
automatically settles outstanding debts by creating carry-forward `ajuste`
transactions in the new period, so nothing is lost (see Carry-Forward below).

**Process**:

1. Earliest active transaction date → `start_date`
2. Current time → `end_date`
3. Count and sum all active transactions
4. Create `exercises` record
5. Set `exercise_id` on all active transactions (moves them out of "active"
   scope) — the archive and the carry-forward ajustes below run in ONE DB
   transaction, so a mid-cut failure rolls everything back

After cutting, the dashboard is empty and ready for a new period.

---

## Carry-Forward (Recurring Spawn)

After a cut, recurring expenses and incomplete installments can be "carried
forward" into the new period.

### Candidates

**Recurrente transactions** that were just archived (have an `exercise_id`)
become candidates for cloning.

**Parcialidad transactions** with `installmentCurrent < installmentTotal` become
candidates.

### Spawn Process

For each selected candidate:

- **Recurrente**: Clone the transaction with `exercise_id = NULL` (now active in
  new period). Same `recurring_group_id` links them.
- **Parcialidad**: Clone with `installmentCurrent` incremented by the specified
  quantity (default 1). Users can carry multiple installments at once.

**Server-side limits**: every selected item must belong to a registry the caller
is a member of (all items are validated, not just the first), batches are capped
at 100 items, and `quantity` must be an integer between 1 and 60 — with
`quantity > 1` only valid for parcialidad sources (recurrente items with a
larger quantity are rejected with a 400, never silently trimmed).

### Disabling

Users can permanently disable a recurring group by setting
`recurring_disabled = true`. This prevents it from appearing in future candidate
lists.

---

## Plans & Limits (Pro tier)

The paid unit is the **registry (group)**: the owner pays, the whole group
benefits. Joining groups is never gated by the joiner's plan — only by the
target group's plan.

|                                        | Free     | Pro       | Grandfathered |
| -------------------------------------- | -------- | --------- | ------------- |
| Owned registries                       | 2        | unlimited | unlimited     |
| Members per registry (incl. owner)     | 2        | unlimited | unlimited     |
| Active recurring/installment templates | 3        | unlimited | unlimited     |
| Closed exercises visible in history    | newest 1 | all       | all           |

Everything else — transactions, payments, cuts, entities — is unlimited on every
plan. The free tier must stay genuinely usable for its core job.

**Grandfathering** is a trust promise: every registry existing when
`add_billing.sql` ran is `grandfathered` forever. The webhook's activation
update only ever writes `'free' → 'pro'`, so it can never touch a grandfathered
registry.

### Plan resolution

A registry is effectively Pro when ANY of:

1. `registries.plan` is `grandfathered` (permanent — nothing can demote it), OR
2. its Polar subscription is `trialing`/`active`, OR
3. the subscription is `canceled` **and** `current_period_end` is still in the
   future (paid through — in-app cancel is cancel-at-period-end, so the user
   keeps Pro for the cycle they paid for), OR
4. the subscription is `past_due`/`canceled`/`revoked` **and** `grace_until` is
   in the future (3-day grace: dunning — never a hard cut), OR
5. `registries.plan` is `pro` **and** no subscription row contradicts it.

Otherwise free — including the revenue-critical case: `plan='pro'` with a
`canceled`/`revoked`/`past_due` subscription **beyond grace**. The webhook
deliberately never writes `plan='free'` on cancel, so **demotion happens on
read, here** — no cron sweeper exists.

Rules 2–4 cover webhook lag in BOTH directions (paid but the flip event hasn't
landed → lifted; canceled but grace holds → not yet cut). See
`lib/entitlements.ts` — this resolution is the single source of truth;
enforcement always goes through it (directly or via
`ctx.state.activeRegistryPlan`).

### Enforcement points

All return `402 {code: "upgrade_required", reason}` (JSON) or a redirect with
`?upgrade=…` (form fallback):

- **3rd owned FREE registry** → `POST /api/registries` blocked. Only
  effectively-free registries consume the cap — grandfathered and Pro groups
  don't (early users keep unlimited creates; a 3rd group can be upgraded after
  creation).
- **Joining a full free group** → `useInvitation` throws a typed
  `GroupFullError`; the join route maps it (via instanceof) to a localized 402.
  Checked AFTER the invitation-uses claim so a full group never burns an invite
  use.
- **4th distinct recurring group** → transaction POST blocked. Templates count
  as distinct `recurring_group_id`s: carry-forward clones and edits of existing
  templates stay free.
- **History depth** → view-level shaping only: older cuts render as locked rows
  with an upgrade CTA (visible teaser, never silent hiding).

### Payment flow (Polar, Merchant of Record)

Every upgrade CTA funnels through the public **`/pricing`** page (tier
comparison rendered from `FREE_LIMITS`, monthly/yearly switcher, prices fetched
from Polar with fallbacks). 402s inside form contexts surface an upgrade toast
with a "Ver planes" link.

```
/pricing (owner of a free registry)
  → GET /api/billing/checkout?registry_id&interval   (owner-checked 302)
  → Polar-hosted checkout (card, tax handled by Polar)
  → success redirect → /billing/success?checkout_id  (syncCheckout, display-only)
  → Polar webhook POST /api/webhooks/polar           (HMAC-verified, authoritative)
      subscription.active → upsert mirror + flip plan to 'pro'
  → user's group is Pro on next request (entitlements read)
```

### Cancellation (in-app, at period end)

The pricing page offers subscribers a discrete cancel link → confirm modal
stating until when the subscription stays active → `POST /api/billing/cancel` →
Polar `PATCH cancel_at_period_end: true`. Pro persists on ALL the subscriber's
registries until `current_period_end`; `undo` reactivates. The Polar hosted
portal ("Administrar suscripción") remains for payment method / invoices.

Checkout Link, products, pricing, and trial length live in the Polar dashboard —
pricing changes never require a deploy. The webhook carries
`metadata.registry_id` from checkout to subscription, which is how a payment
finds its registry.

## Invitation System

### Creating Invitations

- Only registry **owners** can create invitations
- 8-character code generated with `crypto.getRandomValues` (CSPRNG) from
  unambiguous characters (no I, O, 0, 1)
- Optional: expiration time and max uses. Invitations created without an
  explicit expiry (e.g. from the UI) default to **7 days**

### Joining via Invitation

- User navigates to `/join/[CODE]` or enters code on home page
- Validation: not expired, not revoked, under max uses
- If already a member: just sets active registry
- If new member:
  1. Invitation use claimed, membership inserted, default-split invalidation and
     audit logging run in one DB transaction — a failure mid-join rolls the
     claim back, so an invite use is never burned without granting membership
  2. Invitation `current_uses` incremented — atomically: the UPDATE itself
     enforces not-revoked and `max_uses`, so concurrent joins can't overshoot
  3. Active registry set to the joined registry
  4. Audit log entry created

### Revoking

- Owner-only action, scoped in SQL: the revoke only lands if the caller owns the
  invitation's registry — a foreign or unknown id returns 404
- Sets `revoked_at` timestamp
- Audit log entry created

---

## Registry Creation Flow

```
User clicks "Nuevo registro"
→ Form at /registries/new
→ User enters name (e.g., "Viaje Playa")
→ POST /api/registries
→ store.createRegistry() (one DB transaction):
    1. INSERT into registries
    2. INSERT into registry_members as 'owner'
→ Redirect to /dashboard (the registry becomes the active one when the
  client POSTs /api/stamp on load, which sets the server's in-memory
  active-registry map)
```

---

## Caching Architecture

Three caching layers coordinate via the `registries.last_modified` timestamp
(auto-updated by DB trigger on transaction CUD).

### Server Cache (`lib/server-cache.ts`)

In-memory
`Map<registryId, { transactions?, spawnCandidates?, transactionCounts?, lastModified, cachedAt }>`.

- **Shared** across all users on the same Deno process
- **TTL**: 15 minutes
- **Hit condition** (per dataset): the dataset is present AND the cached
  `lastModified` matches the current DB stamp AND the TTL hasn't expired — an
  empty candidate list is a hit, a never-fetched dataset is not
- **Invalidation**: eager `invalidateRegistry()` on any mutation
  (transaction/entity/exercise CUD)
- **Balance**: never cached — pure function of `transactions + userId`

### Client Cache (`lib/cache.ts`)

IndexedDB-backed snapshots per registry.

- **Enables** instant registry switching (no page reload)
- **Written** on every signal change in TransactionList
- **Read** on registry switch via Sidebar
- **Validated** by stamp check in background after switch

### Stamp Check Flow

```
Client wants data for registry X:
  → POST /api/stamp/X  (1 query: SELECT last_modified FROM registries WHERE id = X)
  → Compare with cached lastModified
  → Match → use cache (0 additional queries)
  → Mismatch → fetch fresh data + update cache
```

Server-side follows the same pattern: `getCachedTransactions()` does 1 stamp
query, returns cached transactions on hit.

---

## Realtime & Wake-Up

### Realtime Subscription

Supabase Postgres Changes on `transactions` table, filtered by `registry_id`.
Single active channel per client.

**Events handled**: INSERT (add to signal + notify), UPDATE (replace in signal),
DELETE (filter from signal). Balance re-fetched from `/api/dashboard` on each
event.

### Wake-Up Detection

On PWA resume from background/minimized state:

1. `visibilitychange` (hidden→visible), `resume`, `pageshow` events
2. Track `lastActive` timestamp — if elapsed > 30s, trigger refresh
3. `resubscribe()` — reconnects WebSocket (dropped during sleep)
4. Stamp check — fetch `/api/stamp/{rid}`, compare with cached value
5. If stale — fetch `/api/dashboard`, update signals + cache

---

## Authentication Flow

```
1. User visits /login or /signup
2. AuthForm island handles Supabase auth client-side (persistSession: false)
3. On success, POST to /api/auth/callback with tokens (JSON only)
4. Server validates the tokens with Supabase, then sets HttpOnly cookies:
   - sb-access-token (7 days)
   - sb-refresh-token (30 days)
5. Redirect to /dashboard
```

Google OAuth uses the PKCE flow instead: `/auth/callback` receives a `?code=`
query param (not `location.hash`), exchanges it for a session, then continues at
step 3.

**Middleware** (`main.ts` State): Every request reads `sb-access-token` cookie,
validates with Supabase (refreshing expired tokens single-flight), resolves user
state. Lightweight paths (e.g., `/api/stamp`) skip full `resolveUserState()`.
Signup is open — any authenticated account gets a `users` profile row on its
first request.

**Logout**: Revokes the session server-side (`auth.admin.signOut`), clears both
cookies, and the client wipes service-worker caches / IndexedDB / `sb-*`
localStorage keys before redirecting to `/login`.
