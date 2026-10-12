# Database Documentation

## Overview

Single PostgreSQL database (Supabase-hosted) with UUID primary keys. All
per-registry data uses a `registry_id` foreign key for isolation, replacing the
original app's per-registry SQLite file approach.

**Connection**: Via `pg` connection pool (`lib/db.ts`) using `DATABASE_URL` env
var with SSL.

---

## Tables

### `users` — Unified User Identity + Profile

| Column           | Type        | Constraints                 | Description                                            |
| ---------------- | ----------- | --------------------------- | ------------------------------------------------------ |
| id               | UUID        | PK, auto                    | Unique identifier (the single user ID used everywhere) |
| email            | TEXT        | NOT NULL, UNIQUE            | User email                                             |
| name             | TEXT        | NOT NULL                    | Display name                                           |
| supabase_auth_id | UUID        | UNIQUE                      | Links to Supabase Auth                                 |
| color            | TEXT        | NOT NULL, default '#093eaa' | Hex color for avatar                                   |
| created_at       | TIMESTAMPTZ | NOT NULL, default now()     | Creation timestamp                                     |

**Purpose**: Single table per user. Combines auth identity (email,
supabase_auth_id) with app profile (name, color). Created at signup time. One
row per real person, shared across all registries.

**Indexes**: besides the case-sensitive `UNIQUE` on `email`, a unique expression
index on `lower(email)` (`users_email_lower_uidx`, added by `tighten_rls.sql`)
enforces case-insensitive email uniqueness. A trigger
(`trg_users_protect_identity`) keeps `email` and `supabase_auth_id` immutable
for client (JWT) callers while still allowing server-side sync — see
[Triggers](#triggers).

---

### `registries` — Expense Groups

| Column                     | Type        | Constraints                                                      | Description                                                    |
| -------------------------- | ----------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| id                         | UUID        | PK, auto                                                         | Unique identifier                                              |
| name                       | TEXT        | NOT NULL                                                         | Display name (e.g., "Viaje a la playa")                        |
| is_default                 | BOOLEAN     | NOT NULL, default false                                          | Legacy field                                                   |
| latest_accessed            | TIMESTAMPTZ | NOT NULL, default now()                                          | Last access time                                               |
| default_split_json         | JSONB       | nullable                                                         | Custom default split percentages                               |
| default_split_member_count | INTEGER     | nullable                                                         | Member count when default was set (auto-invalidates on change) |
| entities_json              | JSONB       | default '[]'                                                     | Third-party entities stored as JSON array                      |
| last_modified              | TIMESTAMPTZ | NOT NULL, default now()                                          | Updated by trigger on any transaction CUD                      |
| plan                       | TEXT        | NOT NULL, default 'free', CHECK (`free`\|`pro`\|`grandfathered`) | Billing tier (owner pays, group benefits)                      |
| created_at                 | TIMESTAMPTZ | NOT NULL, default now()                                          | Creation timestamp                                             |

**Purpose**: Central hub for each expense group.

**Entities JSON format**:

```json
[
  { "id": "1", "name": "Landlord", "color": "#6b7280" },
  { "id": "2", "name": "Insurance Co", "color": "#f97316" }
]
```

Entity IDs are auto-incrementing integers (starting from 1). They are scoped to
the registry and can be referenced in `transactions.user_paid` and `split_json`.

---

### `registry_members` — Membership & Roles

| Column      | Type        | Constraints                                   | Description             |
| ----------- | ----------- | --------------------------------------------- | ----------------------- |
| id          | UUID        | PK, auto                                      | Unique identifier       |
| registry_id | UUID        | FK → registries, CASCADE                      | Target registry         |
| user_id     | UUID        | FK → users, CASCADE                           | Member                  |
| role        | TEXT        | NOT NULL, default 'member', CHECK (see below) | `'owner'` or `'member'` |
| joined_at   | TIMESTAMPTZ | NOT NULL, default now()                       | Join timestamp          |

**Unique**: `(registry_id, user_id)` — one membership per user per registry.

**CHECK**: `role IN ('owner', 'member')` (`registry_members_role_check`, added
by `tighten_rls.sql`).

**Roles**:

- `owner`: Can create/revoke invitations, configure default split. Assigned to
  the creator.
- `member`: Standard access, can view/create transactions.

---

### `user_preferences` — Per-User Settings

> **Note**: currently **unused by application code** — the active registry is
> tracked in the server's in-memory map (see `lib/server-cache.ts`), not here.
> The table exists as the durable home for per-user settings if that ever needs
> to survive isolates/restarts.

| Column             | Type        | Constraints                 | Description                 |
| ------------------ | ----------- | --------------------------- | --------------------------- |
| id                 | UUID        | PK, auto                    | Unique identifier           |
| user_id            | UUID        | FK → users, CASCADE, UNIQUE | User                        |
| active_registry_id | UUID        | FK → registries, SET NULL   | Currently selected registry |
| updated_at         | TIMESTAMPTZ | NOT NULL, default now()     | Last update timestamp       |

**Purpose**: Tracks which registry the user is currently viewing. Upserted on
registry switch and invitation acceptance.

---

### `exercises` — Historical Cuts/Settlements

| Column            | Type          | Constraints              | Description            |
| ----------------- | ------------- | ------------------------ | ---------------------- |
| id                | UUID          | PK, auto                 | Unique identifier      |
| registry_id       | UUID          | FK → registries, CASCADE | Registry scope         |
| start_date        | TIMESTAMPTZ   | NOT NULL, default now()  | Period start           |
| end_date          | TIMESTAMPTZ   | NOT NULL, default now()  | Period end             |
| transaction_count | INTEGER       | NOT NULL, default 0      | Number of transactions |
| total_amount      | NUMERIC(12,2) | NOT NULL, default 0      | Total expense amount   |

**Purpose**: Created by the "Cortar" action. Groups transactions into a
historical period. Active transactions have `exercise_id = NULL`.

---

### `transactions` — Expense & Payment Records

| Column                 | Type          | Constraints                           | Description                                                                    |
| ---------------------- | ------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| id                     | UUID          | PK, auto                              | Unique identifier                                                              |
| registry_id            | UUID          | FK → registries, RESTRICT             | Registry scope                                                                 |
| description            | TEXT          | NOT NULL                              | What the expense is for                                                        |
| amount                 | NUMERIC(12,2) | NOT NULL                              | Current amount                                                                 |
| original_amount        | NUMERIC(12,2) | NOT NULL                              | Full/original amount                                                           |
| type                   | TEXT          | NOT NULL, CHECK                       | `'unico'`, `'parcialidad'`, `'recurrente'`, `'pago'`, `'ajuste'`               |
| exercise_id            | UUID          | FK → exercises, SET NULL              | NULL = active, non-null = archived                                             |
| installment_current    | INTEGER       | nullable                              | Current installment number                                                     |
| installment_total      | INTEGER       | nullable                              | Total installments                                                             |
| recurring_disabled     | BOOLEAN       | NOT NULL, default false               | Soft-delete for recurring                                                      |
| recurring_group_id     | UUID          | nullable                              | Groups recurring clones together                                               |
| notes                  | TEXT          | NOT NULL, default ''                  | Optional notes                                                                 |
| split_json             | JSONB         | NOT NULL, default '{"splits":[]}'     | Split data (see below)                                                         |
| creator_id             | UUID          | FK → users, SET NULL                  | Who created it (nullable to preserve transactions if user deleted)             |
| user_paid              | UUID          | NOT NULL                              | Who paid (no FK — can be a user ID or entity ID from registries.entities_json) |
| related_transaction_id | UUID          | FK → transactions, SET NULL, nullable | For 'pago' type: links to the expense transaction this payment settles         |
| created_at             | TIMESTAMPTZ   | NOT NULL, default now()               | Creation timestamp                                                             |

**Key design decisions**:

- `user_paid` has **no FK constraint** — it can reference either `users.id`
  (real member) or an entity ID from `registries.entities_json`
- `creator_id` uses **SET NULL** on delete — transactions are preserved if a
  user is deleted
- `creator_id` is **nullable** for the same reason

---

### `invitations` — Invite Codes

| Column       | Type        | Constraints              | Description              |
| ------------ | ----------- | ------------------------ | ------------------------ |
| id           | UUID        | PK, auto                 | Unique identifier        |
| registry_id  | UUID        | FK → registries, CASCADE | Target registry          |
| code         | TEXT        | NOT NULL, UNIQUE         | 8-char alphanumeric code |
| created_by   | UUID        | FK → users               | Creator                  |
| expires_at   | TIMESTAMPTZ | nullable                 | Expiration time          |
| max_uses     | INTEGER     | nullable                 | Maximum accepted uses    |
| current_uses | INTEGER     | NOT NULL, default 0      | Current accepted count   |
| revoked_at   | TIMESTAMPTZ | nullable                 | Revocation timestamp     |
| created_at   | TIMESTAMPTZ | NOT NULL, default now()  | Creation timestamp       |

**Indexes**: `code`, `registry_id`

**Code generation**: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
(excludes ambiguous: I, O, 0, 1), drawn with `crypto.getRandomValues` (CSPRNG —
invite codes are bearer secrets). Invitations created without an explicit
`expires_at` (e.g. from the UI) default to a 7-day expiry. Accepting an
invitation increments `current_uses` via an atomic check-and-increment UPDATE
that enforces not-revoked and `max_uses` in SQL.

---

### `audit_log` — Audit Trail

| Column      | Type        | Constraints             | Description                          |
| ----------- | ----------- | ----------------------- | ------------------------------------ |
| id          | UUID        | PK, auto                | Unique identifier                    |
| actor_id    | UUID        | FK → users, SET NULL    | Who performed the action             |
| action      | TEXT        | NOT NULL                | Action name (e.g., `invite_created`) |
| target_type | TEXT        | NOT NULL                | Target entity type                   |
| target_id   | UUID        | nullable                | Target entity ID                     |
| metadata    | JSONB       | NOT NULL, default '{}'  | Additional data                      |
| created_at  | TIMESTAMPTZ | NOT NULL, default now() | Timestamp                            |

**Tracked actions**: `invite_created`, `invite_used`, `invite_revoked`

---

### `transaction_payments` — Pago → Expense Allocation Links

Added by `db/add_transaction_payments.sql`.

| Column     | Type          | Constraints                 | Description                                  |
| ---------- | ------------- | --------------------------- | -------------------------------------------- |
| id         | UUID          | PK, auto                    | Unique identifier                            |
| pago_id    | UUID          | NOT NULL, FK → transactions | The payment transaction                      |
| expense_id | UUID          | NOT NULL, FK → transactions | The expense the payment settles (part of)    |
| amount     | NUMERIC(12,2) | NOT NULL, CHECK (> 0)       | How much of the pago applies to this expense |
| created_at | TIMESTAMPTZ   | NOT NULL, default now()     | Creation timestamp                           |

**Purpose**: One `pago` may settle several outstanding expenses (and one expense
may be settled by several pagos). The modal computes allocations by remaining
debt; the API validates that allocations never exceed the pago amount
(`lib/transaction-validation.ts`). The migration backfills one row per legacy
`pago` that used the older single `related_transaction_id` link.

**Indexes**: `idx_tp_pago` (pago_id), `idx_tp_expense` (expense_id).

**RLS**: members of a registry can read/write links whose pago AND expense both
live in that registry (cross-registry links are rejected by the policy, not just
the app).

---

### `push_subscriptions` — Web Push Endpoints

Added by `db/add_push_subscriptions.sql`.

| Column      | Type        | Constraints                    | Description                                       |
| ----------- | ----------- | ------------------------------ | ------------------------------------------------- |
| id          | UUID        | PK, auto                       | Unique identifier                                 |
| user_id     | UUID        | NOT NULL, FK → users, CASCADE  | Owning user                                       |
| endpoint    | TEXT        | NOT NULL, UNIQUE               | Push service URL (the identity of a subscription) |
| p256dh      | TEXT        | NOT NULL                       | Client public key (RFC 8291)                      |
| auth        | TEXT        | NOT NULL                       | Client auth secret (RFC 8291)                     |
| registry_id | UUID        | FK → registries, CASCADE, NULL | Registry the subscription delivers for            |
| created_at  | TIMESTAMPTZ | NOT NULL, default NOW()        | Creation timestamp                                |
| updated_at  | TIMESTAMPTZ | NOT NULL, default NOW()        | Last re-subscription                              |

**Purpose**: Server-side Web Push fan-out on transaction CUD (15s cooldown per
registry). `/api/push/subscribe` upserts on `endpoint` conflict and re-assigns
`user_id`/`registry_id`, so a re-subscribed endpoint can't keep delivering to a
previous owner. The server signs push JWTs with `aud` derived from each
endpoint's origin, so non-FCM services (Firefox, Safari) work.

**Indexes**: `idx_push_subscriptions_user_id`,
`idx_push_subscriptions_registry_id`.

**RLS**: users can SELECT/INSERT/DELETE only their own subscriptions (no UPDATE
policy — the app server handles updates and bypasses RLS).

---

## Split JSON Format

The `split_json` JSONB field in transactions:

```json
{
  "splits": [
    {
      "userId": "uuid-1",
      "percentage": 50.0,
      "amount": 150.0
    },
    {
      "userId": "uuid-2",
      "percentage": 50.0,
      "amount": 150.0
    }
  ]
}
```

For `pago` (payment) and `ajuste` (adjustment) types, split contains single
recipient:

```json
{
  "splits": [
    {
      "userId": "recipient-uuid",
      "percentage": 100,
      "amount": 50.0
    }
  ]
}
```

The `userId` can be either a `users.id` (real member) or an entity ID from
`registries.entities_json`.

---

## Entity Relationships

```
users ──┬── registry_members ──── registries
        │                              │
        ├── user_preferences           ├── transactions (via creator_id)
        │                              ├── exercises
        ├── invitations (created_by)   ├── invitations
        │                              └── entities (stored in entities_json)
        └── audit_log (actor_id)
```

---

## Triggers

### `trg_transactions_registry_modified` — Auto-update `last_modified`

**On**: `transactions` table, AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW

**Function**: `update_registry_last_modified()`

Sets `registries.last_modified = now()` for the affected `registry_id` whenever
a transaction is created, updated, or deleted. Used by both client and server
caching layers to detect stale data.

### `trg_users_protect_identity` — Immutable identity columns

**On**: `users` table, BEFORE UPDATE, FOR EACH ROW

**Function**: `protect_user_identity_columns()` (created by `tighten_rls.sql`)

When the request carries a Supabase user JWT (`auth.uid() IS NOT NULL` — i.e.
PostgREST/Realtime client roles), forces `email` and `supabase_auth_id` back to
their OLD values, so a client can't change its own identity (account takeover /
allowlist bypass). The app server connects directly without JWT claims, so
server-side email sync and name updates are unaffected; `name`/`color` remain
editable by clients.

---

## Migrations

Migrations must be run in order:

1. **`schema.sql`** — Full PostgreSQL schema (tables, constraints, indexes)
2. **`add_*.sql`** — Incremental feature migrations:
   - `add_push_subscriptions.sql` — Web Push subscriptions table (+ its own RLS
     block)
   - `add_related_transaction_id.sql` — `related_transaction_id` column on
     `transactions`
   - `add_registry_last_modified.sql` — `last_modified` column, the
     `update_registry_last_modified()` function and its trigger
   - `add_transaction_payments.sql` — expense↔payment links table (+ RLS)
   - `add_transaction_balances.sql` — per-user balance deltas table (+ RLS),
     with a backfill for existing transactions
3. **`enable_rls.sql`** — Enables Row-Level Security on all tables and creates
   the policies + helper functions (`app_user_id()`, `is_registry_member()`).
   Re-runnable: every `CREATE POLICY` is preceded by `DROP POLICY IF EXISTS`
4. **`tighten_rls.sql`** — Idempotent hardening follow-up. **Existing projects
   that already applied the files above run this next** (fresh setups just run
   the whole chain). See [Row-Level Security](#row-level-security) below
5. **`enable_realtime.sql`** — Codifies
   `ALTER PUBLICATION supabase_realtime ADD TABLE transactions` (idempotent)
6. **`add_billing.sql`** — Pro-tier billing: `registries.plan` column
   (`free`|`pro`|`grandfathered`, existing rows grandfathered) and the
   `registry_subscriptions` mirror table (server-only, zero RLS policies).
   **Must run before deploying billing code.**
7. **`add_subscription_cancel_flag.sql`** — Adds
   `registry_subscriptions.cancel_at_period_end` (in-app cancel scheduling).
8. **`migrate_billing_to_per_user.sql`** — Re-keys `registry_subscriptions` from
   registry_id to user_id (per-user model): backfills the owner, dedupes
   multiple subs per user (OPS: cancel the extras in Polar), swaps the PK.
9. **`drop_allowed_emails.sql`** — Drops the registration allowlist (the app
   went public; signup is open). **Must run AFTER deploying the code that stops
   reading it** — the previously deployed code JOINs the table on every
   authenticated request. No-op on fresh installs (schema.sql no longer creates
   the table).

Run order: `schema.sql` → `add_*.sql` → `enable_rls.sql` → `tighten_rls.sql` →
`enable_realtime.sql` → `add_billing.sql` → `drop_allowed_emails.sql` (the last
one deploy-gated as noted).

---

## Row-Level Security

**Posture**: the app server connects as a privileged role that bypasses RLS by
design — authorization lives in the middleware/route layer. RLS exists to
protect the two paths that reach the database with end-user credentials:

- **Supabase Realtime** — subscribers connect with the user's JWT, so policies
  gate which rows a channel can deliver
- **Direct PostgREST access** via the Supabase client

All tables have `ENABLE` + `FORCE ROW LEVEL SECURITY`. Helper functions
`app_user_id()` (maps `auth.uid()` → `users.id`) and
`is_registry_member(reg_id)` back the policies. Both have
`REVOKE EXECUTE ... FROM PUBLIC` — note this does not block RPC calls from
Supabase's default-granted authenticated roles, but calling either directly is
harmless (they only read the caller's own identity/membership).

Key policy points (final state after `tighten_rls.sql`):

- `registry_members`: **no client INSERT policy** — joins happen server-side
  only
- `invitations`: SELECT scoped to `is_registry_member(registry_id)` (was: any
  authenticated user)
- `registries`: DELETE requires the `owner` role
- `transactions`: per-command policies — SELECT by membership; INSERT also
  requires `creator_id = app_user_id()`; UPDATE/DELETE only while
  `exercise_id IS NULL` (settled transactions are immutable for clients)
- `audit_log`: no client policies at all (server-only table)
- `transaction_payments`: expense and pago must belong to the **same** registry
- `transaction_balances`, `push_subscriptions`: membership/self-scoped (their
  `add_*.sql` migrations carry matching RLS blocks)
- `users`: `email`/`supabase_auth_id` immutable for JWT callers via
  `trg_users_protect_identity`; `role` CHECK on `registry_members`; unique index
  on `lower(email)`

---

## `transaction_balances` — Persisted Balance Deltas

| Column         | Type          | Constraints                             | Description                               |
| -------------- | ------------- | --------------------------------------- | ----------------------------------------- |
| transaction_id | UUID          | FK → transactions(id) ON DELETE CASCADE | The transaction this delta belongs to     |
| user_id        | UUID          | NOT NULL (not FK — may be an entity id) | The user/entity whose balance is affected |
| amount         | NUMERIC(12,2) | NOT NULL                                | Signed delta, pre-rounded to cents        |

**Primary key**: `(transaction_id, user_id)`

**Indexes**: `idx_tb_transaction(transaction_id)`, `idx_tb_user(user_id)`

**Purpose**: Stores the exact, rounded-to-cent balance impact of each
transaction on each affected user. Balance is then an exact `NUMERIC` SUM:

```sql
SELECT COALESCE(SUM(amount), 0) FROM transaction_balances tb
JOIN transactions t ON t.id = tb.transaction_id
WHERE tb.user_id = $1 AND t.registry_id = $2 AND t.exercise_id IS NULL
```

This eliminates the floating-point residue that caused 1-2 cent discrepancies
between users after a full payment. Deltas are computed by the pure
`computeDeltas()` function in `lib/balances.ts` and written at transaction
creation/update time. `ON DELETE CASCADE` handles cleanup when a transaction is
deleted.

---

## `registry_subscriptions` — Polar Subscription Mirror

| Column                | Type        | Constraints                                                               | Description                                      |
| --------------------- | ----------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| user_id               | UUID        | PK (per-user: one subscription per user), FK → users ON DELETE CASCADE    | The subscriber — unlocks every registry they own |
| polar_subscription_id | TEXT        | UNIQUE                                                                    | Polar subscription id                            |
| polar_customer_id     | TEXT        | nullable                                                                  | Polar customer id (portal sessions)              |
| status                | TEXT        | NOT NULL, CHECK (`trialing`\|`active`\|`past_due`\|`canceled`\|`revoked`) | Mirrored Polar status                            |
| current_period_end    | TIMESTAMPTZ | nullable                                                                  | End of the paid period                           |
| grace_until           | TIMESTAMPTZ | nullable                                                                  | Cancellation grace (3 days) — no mid-period cuts |
| updated_at            | TIMESTAMPTZ | NOT NULL, default now()                                                   | Last webhook update                              |

**Purpose**: Server-side mirror of the Polar subscription state for a USER (one
subscription per user — unlocks Pro on every registry the subscriber owns;
originally per-registry, re-keyed by `db/migrate_billing_to_per_user.sql`).
Written exclusively by the webhook handler (`POST /api/webhooks/polar`) and the
cancel route's flag update. RLS is enabled and forced with **zero policies** —
client roles see no rows (same posture as `audit_log`).

Plan resolution (`lib/entitlements.ts`): a registry is effectively Pro when
`registries.plan IN ('pro','grandfathered')` OR the subscription is
`trialing`/`active` OR `past_due` with an unexpired `grace_until`. The
subscription check covers webhook lag and dunning without hard-cutting.
