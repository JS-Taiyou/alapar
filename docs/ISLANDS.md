# Interactive Components (React)

The interactive components are React 19 function components hydrated by Astro
(`client:load`). They live under `src/components/` — `auth/`, `billing/`,
`dashboard/`, `demo/`, `ui/` — and use plain `useState`/`useReducer`; there is
no Preact and no signals library.

## Dashboard state — `components/dashboard/dashboard-store.ts`

The /dashboard page hydrates a single React tree (`DashboardShell`): Sidebar +
transaction list + Toaster under one root, so sibling synchronization happens
through ordinary state instead of cross-island messaging. The store is a
`useReducer` whose `DashboardState` holds the twelve dashboard data pieces
(transactions, payments, users, balance, breakdown, default split, spawn
candidates, stamp, entities, entity ids, current user, registry id). All
mutations — realtime events, registry switches, the modal's optimistic writes —
are typed actions:

- `APPLY_SNAPSHOT` — a registry snapshot from `/api/dashboard` or the IndexedDB
  cache (ISO `createdAt` strings are coerced back to `Date`); absent fields
  keep the current state
- `REALTIME_INSERT / DELETE / UPDATE` — Supabase Postgres Changes payloads;
  INSERT dedupes/merges our own optimistic row; every mutation recomputes the
  personal balance and pairwise breakdown in the reducer (`withBalances`)
- `SET_TRANSACTIONS / SET_TRANSACTION_PAYMENTS / REBALANCE` — the transaction
  modal's optimistic write, server merge and rollback paths
- `SET_ENTITIES / SET_ENTITY_IDS / SET_LAST_MODIFIED`

The demo page (`DemoApp`) runs the same reducer seeded with static data.

The upgrade toasts are the one piece of cross-cutting client state: a tiny
framework-agnostic store (`components/ui/toast-store.ts`, subscribe/snapshot)
bound to React with `useSyncExternalStore`. `showUpgradeToast(locale, key)` is
importable from anywhere client-side.

---

## `AuthForm` — `components/auth/AuthForm.tsx`

**Props**:
`{ mode: "login" | "signup", supabaseUrl: string, supabaseAnonKey: string, locale?: Locale }`

Client-side authentication form using Supabase JS SDK directly in the browser.

**Behavior**:

- Creates a Supabase client with the provided URL and anon key, with
  `persistSession: false` — sessions live in `HttpOnly` cookies, never in
  browser storage
- **Signup flow**: Calls `signUp()`, then sends tokens to `/api/auth/callback`
  via POST (open signup — no allowlist)
- **Login flow**: Calls `signInWithPassword()`, then sends tokens to
  `/api/auth/callback`
- **Google OAuth**: Uses a dedicated PKCE client (`flowType: "pkce"`,
  `persistSession: true` — required only so the code verifier survives the
  redirect round-trip) and redirects through `/auth/callback`, where
  `AuthCallback` exchanges the `?code=` param; the stored `sb-*` keys are wiped
  after the exchange
- On success, redirects to `/dashboard` (or to a validated relative
  `redirect`/`next` path — absolute URLs are rejected)
- Shows password toggle (eye icon, hold to reveal)
- Cross-links between login and signup pages

**Validation**: Email required, password minimum 6 characters, name required for
signup.

---

## `AuthCallback` — `components/auth/AuthCallback.tsx`

**Props**:
`{ redirectPath: string, supabaseUrl: string, supabaseAnonKey: string }`

OAuth landing page (`/auth/callback`) for the Google sign-in flow. The card
chrome lives in the page (`AuthCardLayout.astro`); the island is only the
interactive status content.

**Behavior**:

- Reads the `?code=` query param (PKCE flow — the older `location.hash` implicit
  flow is gone)
- Creates a PKCE client (`flowType: "pkce"`, `persistSession: true` — required
  only to read the code verifier left in localStorage by the initiating client)
  and calls `exchangeCodeForSession(code)`
- Wipes the stored `sb-*` localStorage keys immediately after the exchange
  (`clearSupabaseBrowserStorage`) — sessions live in `HttpOnly` cookies
- Strips the consumed single-use code from the URL via `history.replaceState`
- POSTs the session tokens to `/api/auth/callback`; on 400/401 restarts at
  `/login`
- `redirectPath` is validated to a relative same-origin path (also enforced
  server-side) — anything else falls back to `/dashboard`
- Renders a branded spinner, or an error card with a collapsible
  technical-details block

---

## `CortarButton` — `components/dashboard/CortarButton.tsx`

**Props**: `{ hasTransactions: boolean, registryId: string, isDemo?: boolean }`

The "Cortar" (cut/settle) button in the dashboard header (hidden on the demo
page).

**Business Logic**:

- Button is **only enabled** when `hasTransactions === true`
- On click, opens a confirmation modal (shared `Modal` component, Escape to
  close), then POSTs to `/api/exercises` and reloads
- A failed cut shows an error alert instead of reloading — a rejected cut is
  never indistinguishable from a successful one

**Disabled state**: Grayed out, `cursor-not-allowed`, when no transactions
exist.

---

## `EntityManager` — `components/dashboard/EntityManager.tsx`

**Props**: `{ registryId: string, entities: Entity[], onEntitiesChanged: (entities: Entity[] | null) => void }`

Modal (shared `Modal` scaffold) for managing third-party entities (terceros).
Button with users icon. Rendered inside the Sidebar (desktop and mobile asides
share the Sidebar's local entity-list mirror).

**Behavior**:

- On create: POSTs to `/api/entities` with `{ name, color, registryId }`
- On edit: PUTs to `/api/entities/[id]` with `{ name, color }`
- On delete: DELETEs `/api/entities/[id]` (fails with 409 if entity has active
  transactions)
- Shows color picker (8 preset colors)
- Entities display with avatar initials and "Tercero" badge
- After any change, announces the fresh entity list through `onEntitiesChanged`
  (or `null` when the post-mutation refetch itself failed — the Sidebar then
  retries the fetch and, in the shell, forwards the result to the store, which
  also refreshes the entity ids)

---

## `DefaultSplitConfig` — `components/dashboard/DefaultSplitConfig.tsx`

**Props**:
`{ registryId: string, users: User[], defaultSplit: DefaultSplit | null, isOwner: boolean, autoOpen?: boolean, onClose?: () => void }`

Owner-only modal (shared `Modal` scaffold) for configuring default split
percentages. Opened per-registry from the Sidebar's "%" action.

**Behavior**:

- Shows all participants with percentage inputs
- POSTs to `/api/registries/default-split` with `{ splits, registryId }`
- DELETEs to `/api/registries/default-split` to clear (reloads — the default
  split feeds the SSR-rendered dashboard)
- Auto-complement for 2 users (editing one fills the other to 100%)
- Percentages must sum to 100% before the save button enables

---

## `JoinButton` — `components/auth/JoinButton.tsx`

**Props**: `{ code: string, locale?: Locale }`

Single button on the `/join/[code]` page for authenticated users to accept an
invitation.

**Behavior**:

- POSTs to `/api/invitations/join` with the invitation code
- On success, redirects to `/dashboard`
- Shows loading state and error messages; a 402 (member cap) also offers the
  `/pricing` link

---

## `JoinCodeForm` — `components/auth/JoinCodeForm.tsx`

No props. Simple form on the home page for entering an invite code.

**Behavior**:

- Text input (max 8 chars) + submit button
- On submit, navigates to `/join/[CODE]` with the uppercase-trimmed code
- No API call — just client-side navigation

---

## `RecurringSpawn` — `components/dashboard/RecurringSpawn.tsx`

**Props**: `{ candidates: SpawnCandidate[], isDemo?: boolean }`

(`SpawnCandidate` comes from `lib/types.ts` — shared with the dashboard handler
and the registry-switch snapshot.)

Manages recurring expense carry-forward after a cut. Button with refresh icon
and badge count.

**SpawnCandidate**:
`{ id, description, type, originalAmount, installmentCurrent, installmentTotal }`

**Behavior**:

- Renders nothing if no candidates exist
- Opens modal showing all candidate transactions with checkboxes
- For **parcialidad**: shows installment progress (e.g., "3/12") and quantity
  selector (+/- buttons)
- Users can **disable** recurring items (POSTs to
  `/api/transactions/disable-recurring`)
- On confirm: POSTs checked items with quantities to
  `/api/exercises/carry-forward`, then reloads
- A failed spawn shows an error alert instead of reloading silently

---

## `SearchBar` — `components/dashboard/SearchBar.tsx`

**Props**: `{ placeholder?: string, filterSelector?: string }`

Search input for the exercise history page.

**Behavior**:

- Text input with search icon, updates state on input
- When `filterSelector` is given (history passes `[data-exercise-card]`), hides
  the DOM nodes whose text doesn't match the query — client-side filtering over
  the server-rendered cards

---

## `Sidebar` — `components/dashboard/Sidebar.tsx`

**Props**:
`{ registries: Registry[], activeRegistryId: string, userName: string, userInitials: string, userPro: User["pro"], isOwner: boolean, ownerRegistryIds: Set<string>, entities: Entity[], registryUsers: User[], defaultSplit: DefaultSplit | null, deletableRegistryIds: Set<string>, initialCollapsed?: boolean, locale?: Locale, showUpgrade?: boolean, onRegistrySwitch?: (id: string) => void, onEntitiesChanged?: (entities: Entity[]) => void }`

Collapsible sidebar with user info, registry list, entity manager, default split
config, invite button, and actions. On `/dashboard` it renders inside the
`DashboardShell` (one React tree); the history pages mount it standalone via
`SidebarIsland.astro` — there, without a shell to broadcast to, switching
registries records the choice in IndexedDB and lands on `/dashboard`.

**Registry list**: Sorted — active registry always first, rest alphabetically by
name. `activeRegistryId` comes from the shell's store and updates on switch (no
page reload needed).

**Desktop behavior**:

- Collapsible via chevron button (full width → icon-only)
- Lists all registries with color-coded dots
- Active registry has highlighted background
- Click a registry → cache-aware switch through `onRegistrySwitch` (no full
  page reload)

**Mobile behavior**:

- Hamburger menu button (fixed bottom-left)
- Slides in from left with backdrop overlay
- Close button in header
- Two-finger swipe from left edge to open (PWA mode)
- `touch-action: manipulation` prevents zoom interference

**Cache-aware registry switch** (owned by `DashboardShell`, called through the
`onRegistrySwitch` prop):

1. Read the IndexedDB snapshot for the target registry (guarded by a generation
   counter so a slower stale switch can't overwrite a newer one)
2. If a snapshot exists, apply it as an `APPLY_SNAPSHOT` action → the whole
   dashboard updates instantly
3. Background: POST `/api/stamp/{id}` (which also marks the registry active
   server-side) → compare `lastModified` → re-apply fresh data if stale
4. No snapshot → fetch `/api/dashboard?registryId=…` and apply that (full
   reload only on network failure)

On mount the shell also drops orphaned IndexedDB snapshots and restores the
last-active registry from the previous session.

**Optimistic updates**: registry rename (and delete) apply instantly and roll
back if the server rejects the request — a 403/409 never leaves a phantom rename
in the list.

**Owner-only features**:

- "Invitar" button opens the invite-code modal (shared `Modal` scaffold)
- Rename / configure default split / delete actions on each owned registry row
  (delete only offered for registries with zero transactions)

**Actions**:

- "Nuevo Registro" — creates the registry inline (optimistic row, 402 surfaces
  the upgrade toast)
- "Cerrar sesión" — POSTs to `/api/auth/logout` (which revokes the session
  server-side), then wipes every service-worker cache (directly and via the
  `CLEAR_CACHES` SW message), clears the IndexedDB registry snapshots, removes
  any `sb-*` localStorage keys, and redirects to `/login`

---

## `BalanceBreakdown` — `components/dashboard/BalanceBreakdown.tsx`

**Props**:
`{ balance: number, entries: BalanceBreakdownEntry[], users: Participant[], locale?: Locale }`

Interactive popover in the dashboard header showing pairwise debt breakdown for
multi-user registries.

**Behavior**:

- Always renders the total balance amount (green if positive, red if negative)
- When more than 2 participants: the balance becomes a clickable button with a
  chevron indicator
- On click, opens a popover below the balance showing per-person breakdown:
  - **"Te deben"** section (green): lists users who owe the current user, with
    amounts
  - **"Debes"** section (red): lists users the current user owes, with amounts
  - Each entry shows the user's avatar initials (colored with `userColor`),
    name, and signed amount
  - Empty state: checkmark icon + "Todos están balanceados"
- Click outside the popover to dismiss (fixed backdrop overlay)
- When 2 or fewer participants: behaves like the old static display (no popover,
  `cursor-default`)

**Data source**: `calculatePairwiseBreakdown()` from `lib/calculations.ts`,
recomputed in the store reducer on every mutation (seeded server-side).

---

## `DashboardShell` — `components/dashboard/DashboardShell.tsx`

**Props**: the merged server data for the sidebar chrome (via
`lib/sidebar-props.ts`) and the content column; mounted with `client:load` by
`dashboard/index.astro`.

The single hydration root for `/dashboard`: owns the `useReducer` store, the
async registry-switch flow and the Toaster, and renders `Sidebar` + the content
(header with `BalanceBreakdown`/`RecurringSpawn`/`CortarButton` when the
registry has multiple participants, then `TransactionList`).

---

## `TransactionList` — `components/dashboard/TransactionList.tsx`

**Props**:
`{ state: DashboardState, dispatch: Dispatch<DashboardAction>, supabaseUrl?: string, supabaseAnonKey?: string, isDemo?: boolean, locale?: Locale }`

The main transaction list on the dashboard. Handles listing, CRUD, caching, and
realtime updates. No access token is ever passed as a prop — the realtime client
fetches it from `/api/auth/token` when subscribing.

**Features**:

- Lists all active transactions with per-user balance display
- Desktop: floating FAB buttons for "Agregar pago" and "Agregar gasto" (visible
  on `sm:` and up)
- Mobile: inline "Agregar" button that expands to "Pago" / "Gasto" pair (visible
  below `sm:`)
- Clicking a transaction card opens modal for **editing** that transaction
- Supports all transaction types: unico, parcialidad, recurrente, **pago**,
  **ajuste**
- Entity participants show a "tercero" badge (identified via the store's
  `entityIds`)

**Caching**:

- On state change: writes the full snapshot to IndexedDB via `lib/cache.ts`
  (transactions, payments, balance, users, lastModified)
- Registry switches arrive as `APPLY_SNAPSHOT` dispatches from the shell — no
  listener needed
- Deserializes `createdAt` strings back to `Date` objects on arrival (done by
  the reducer)

**Realtime** (one `useEffect` keyed on `[registryId, supabase credentials]`,
reading live state through a ref so the channel isn't re-subscribed on every
change):

- Subscribes to Supabase Postgres Changes on `transactions` table filtered by
  `registry_id`
- Handles INSERT/UPDATE/DELETE by dispatching reducer actions; the reducer
  recomputes balance + pairwise breakdown
- Browser notifications for other users' inserts (15s cooldown)
- Subscribes to Web Push for background notifications

**Wake-up detection**:

- Listens to `visibilitychange`, `online`, and `pageshow` events
- If backgrounded for >30s: compares stamp via `POST /api/stamp/{rid}` →
  refreshes if stale
- Reconnects realtime WebSocket via `resubscribe()` on wake-up

**Pago (Payment) Mode**:

- Different UI: shows "Pagó" and "Recibió" radio columns instead of split table
- Creates a `TransactionSplit` with single recipient at 100%
- Cannot select same user as both payer and recipient
- **Pairwise balance indicators** (when registry has 3+ users):
  - A "SALDO" column header appears in the payment table
  - For each non-self user, shows either:
    - **"Te debe $X"** (green) — if that user owes the current user
    - **"Le debes $X"** (red) — if the current user owes that user
    - Nothing — if balance between them is settled (~$0.00)
  - Self row shows no indicator (can't owe yourself)
  - Helps users decide who to pay and how much, without leaving the modal

**Default Split**:

- "Default" button pre-fills percentages from the store's `defaultSplit`
- Falls back to equal split if no default configured

**Edit Mode**:

- Pre-populates all fields from the transaction
- Infers `splitMode` from the saved split: auto (equal percentages), percentage
  (custom %), or fixed (custom amounts that sum to total)
- Shows "Eliminar" button (with confirmation dialog) that DELETEs the
  transaction

**Balance Display per Transaction**:

- For expenses: shows personal balance (green if positive, red if negative) +
  "de $total" subtitle
- For payments/adjustments: shows indigo/amber-colored amount with contextual
  label ("Le pagaste a X" / "Te pagó X")
- Installments show the per-installment portion (divided by `installmentTotal`)

**Submit** (see `TransactionModal`): optimistic writes go through the
`onTransactionsChange` / `onTransactionPaymentsChange` / `onRecalculate`
callbacks, which dispatch store actions.

---

## `TransactionModal` — `components/dashboard/TransactionModal.tsx`

**Props**: plain values from the store (`transactions`, `users`,
`currentUserId`, `registryId`, `balanceEntries`, `defaultSplit`, `entityIds`,
`transactionPayments`) plus its own open state (`isOpen`, `editingId`,
`modalMode`) and the callbacks `onClose`, `onReopen`, `onTransactionsChange`,
`onTransactionPaymentsChange`, `onRecalculate`, `onServerStamp`. The unused
`entities` prop from the signals era was dropped.

**Behavior**:

- New: POSTs FormData to `/api/transactions`; edit: PUTs FormData to
  `/api/transactions/[id]`
- Optimistic flow preserved verbatim from the signals version: the row is
  written optimistically through `onTransactionsChange`, then replaced by the
  server response; on failure the pre-submit snapshot is restored and the modal
  **reopens with the user's input intact** (`onReopen` + a reopen-without-reset
  guard)
- Demo mode: swaps the optimistic id for a fresh uuid locally, no network
- Persists the last split config per registry in `localStorage` (same-day only)
- The 402 recurring-template cap surfaces `showUpgradeToast` instead of an alert
- `onServerStamp` relays the registry's fresh `last_modified` so the caller can
  label its cached snapshot with the version its own write produced

---

## `DemoTour` — `components/demo/DemoTour.tsx`

**Props**: `{ locale?: Locale }`. Floating tour button (bottom-left) on the
`/demo` page, powered by driver.js.

**Behavior**:

- Auto-opens the tour picker on first visit (suppressed afterwards via a
  `localStorage` flag; the button always remains)
- **Tour Rápido** (5 steps): dashboard highlights only
- **Tour Completo**: additionally opens the real expense modal (clicks the FAB
  programmatically), walks the type/split-mode controls, then closes it by
  dispatching a synthetic Escape — which works because every modal gets its
  Escape handling from the shared `Modal` component — and repeats inside the
  payment modal for the pay-exact-debt step
- Tour end/dismissal is detected via driver's `onDestroyed` hook

---

## `UpgradeButton` — `components/ui/UpgradeButton.tsx`

**Props**: `{ locale: Locale }`

"Mejorar a Pro" CTA in the sidebar footer (rendered only when the active
registry isn't Pro). Plain link to the public `/pricing` page — a subscription
is per-user and lifts every group the subscriber belongs to, so it's shown to
owners and members alike.

---

## `LocaleToggle` — `components/ui/LocaleToggle.tsx`

**Props**: `{ locale: Locale, full?: boolean, className?: string }`

ES/EN pill toggle (`role="group"` + `aria-pressed`). POSTs the choice to
`/api/locale` and reloads so the SSR re-renders in the new language.

---

## `ForgotPassword` — `components/auth/ForgotPassword.tsx`

**Props**: `{ supabaseUrl: string, supabaseAnonKey: string, locale?: Locale }`

Email-only form on `/forgot-password`: calls Supabase `resetPasswordForEmail`
client-side (redirecting back to `/reset-password`) and shows the localized
confirmation.

---

## `ResetPassword` — `components/auth/ResetPassword.tsx`

**Props**: `{ supabaseUrl: string, supabaseAnonKey: string, locale?: Locale }`

New-password form on `/reset-password`: establishes the recovery session in
memory only (`setSession` — never persisted), updates the password via
`updateUser`, then shows a success card linking to `/login` (the recovery
session is intentionally not turned into an app session).

---

## `Toaster` — `components/ui/Toaster.tsx`

**Props**: none (mounted once, inside `DashboardShell`, so it covers the
dashboard).

The 402 funnel: when a paywalled action fails inside a form context (4th
recurring template, 3rd owned registry), the data rolls back and
`showUpgradeToast(locale, messageKey)` — exported from
`components/ui/toast-store.ts`, callable from anywhere client-side — pushes a
dismissible toast (auto-dismiss 6s) carrying the localized limit message plus a
"Ver planes →" link to `/pricing`. The store is framework-agnostic
(subscribe/snapshot); the React binding uses `useSyncExternalStore`. Producers:
`Sidebar.handleCreateRegistry`, `TransactionModal` submit (templates cap).

---

## `BillingActions` — `components/billing/BillingActions.tsx`

**Props**:
`{ locale: Locale, activeUntil: string | null, cancelScheduled: boolean, currentInterval: "monthly" | "yearly" | null }`

The discrete billing controls for live subscribers, shown on `/pricing`:
"Cancelar suscripción" opens a confirm modal (shared `Modal`) stating that
access continues until `activeUntil`; "Reactivar" undoes a scheduled cancel; the
prorated monthly↔yearly switch has its own confirm modal; "Administrar
suscripción" opens the hosted Polar portal. Talks to `POST /api/billing/cancel`,
`POST /api/billing/switch` and `POST /api/billing/portal`.
