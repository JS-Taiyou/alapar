# Migración a Astro (rama `migration/astro`, worktree `../alapar-astro`)

Estado: **port completo del código — pendiente de hardening y despliegue.**

La app Deno Fresh original sigue intacta en la rama `main` (worktree
`../alapar-fresh`). Esta rama reemplaza Deno + Fresh + Deno Deploy por
**Astro 7 + React 19 + adaptador Netlify**, manteniendo Supabase (auth +
Postgres). El toolchain de lint/formato/tests es **Vite+ (`vp`)**: Vite 8
(queda fijado a `@voidzero-dev/vite-plus-core` vía override de npm), Oxlint,
Oxfmt y Vitest.

## Qué se hizo

| Área                                                | Origen (Fresh)                         | Destino (Astro)                                            |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Shell HTML                                          | `routes/_app.tsx`                      | `src/layouts/Base.astro`                                   |
| Middleware (csrf, headers, rate limit, auth, guard) | `main.ts`                              | `src/middleware.ts` (`context.locals` ≈ `ctx.state`)       |
| Lógica de negocio                                   | `lib/*.ts`                             | `src/lib/*.ts` (sin tests, ver pendientes)                 |
| Páginas                                             | `routes/**.tsx`                        | `src/pages/**.astro`                                       |
| API                                                 | `routes/api/**.ts` (`define.handlers`) | `src/pages/api/**.ts` (`APIRoute` por método)              |
| Islands (Preact)                                    | `islands/*.tsx`                        | `src/components/**.tsx` + `client:load` (React, ver abajo) |
| Componentes                                         | `components/*.tsx`                     | `src/components/**` (`.astro` los presentacionales)        |
| Estáticos                                           | `static/`                              | `public/`                                                  |
| Demo data                                           | `data/demo.json`                       | `src/data/demo.json`                                       |
| 404                                                 | `app.notFound`                         | `src/pages/404.astro`                                      |

Cambios estructurales notables:

- **Env vars**: `src/lib/env.ts` lee `import.meta.env` con fallback a
  `process.env` (dev Vite vs runtime Netlify).
- **Postgres local**: sin `DATABASE_URL`, `src/lib/db.ts` cae a
  `postgresql://alapar:alapar@localhost:5432/alapar` (sin SSL).
  `docker-compose.yml` incluido por si no hay Postgres local; el esquema se
  aplica con `db/schema.sql` (los `add_*.sql` son incrementales históricos).
- **Señales de página**: Fresh creaba signals en páginas servidor; Astro no
  puede serializarlas. Se eliminaron por completo (ver "Preact → React"):
  el dashboard hidrata una sola raíz React (`DashboardShell`) cuyo
  `useReducer` (`src/components/dashboard/dashboard-store.ts`) posee el
  estado compartido; la demo corre el mismo reducer con datos estáticos.
- **CSRF**: el plugin `csrf()` de Fresh se reimplementó inline en el
  middleware (excepción `/api/webhooks/polar` preservada).
- **Alias `@/*` → `src/*`** configurado en `tsconfig.json`.

## Preact → React (segunda fase de la migración)

Los 29 componentes TSX (~7.700 líneas) se portaron de Preact + `@preact/signals`
a React 19, y con ellos desapareció el último residuo arquitectural de Fresh:

- **Bus de señales entre islas eliminado** (`src/islands/shared-signals.ts`):
  `registrySwitch` y `entitiesChanged` existían porque en Fresh las islas no
  pueden compartir árbol. Ahora `/dashboard` hidrata una sola raíz
  (`DashboardShell.tsx`): Sidebar + lista + Toaster en un árbol React con un
  `useReducer` tipado (`dashboard-store.ts`).
- **Contratos de props**: los 12 `Signal<T>`-como-prop pasaron a valores
  planos; el patrón hijo-muta-señales-del-padre del `TransactionModal` pasó a
  callbacks (`onTransactionsChange`, `onReopen`, …). El flujo optimista
  (rollback + reapertura sin perder input) quedó verbatim.
- **Componentes SSR-only → `.astro`**: ExerciseCard, PaywallCard,
  TransactionCard y AuthCardLayout son componentes `.astro` nativos (cero JS
  de cliente). `AuthCallback` hidrata solo el contenido interactivo.
- **Toaster**: store framework-agnostic (`ui/toast-store.ts`) + binding React
  con `useSyncExternalStore`; `showUpgradeToast` mantiene su firma.
- **Carpetas**: `src/islands/` desaparece; todo vive en
  `src/components/{auth,billing,dashboard,demo,history,ui}/`. El armado de
  props del Sidebar está en `src/lib/sidebar-props.ts`; las páginas de
  histórico montan el Sidebar standalone (`SidebarIsland.astro`), donde
  cambiar de registro ahora navega a `/dashboard` (antes quedaba stale).
- **Idiomas JSX**: `class` → `className`, atributos SVG con guion → camelCase,
  `style` string → objeto, `autofocus` → `autoFocus` (~700 reemplazos).
- La suite de tests (489) no toca la capa de componentes y siguió verde
  durante todo el proceso.

## Verificado

- `npx astro check`: 0 errores, 0 warnings (109 archivos) — con Astro 7.3.8 y
  TypeScript 6.0.3.
- `npx astro build`: OK, función SSR de Netlify generada.
- Smoke test dev: `/login`, `/pricing`, `/demo`, `/join/:code` → 200;
  `/` y `/dashboard` → 302 a `/login` (guard); `/api/*` sin sesión → 401 JSON.
- Fallback Postgres local (`alapar`/`alapar`/`alapar`) probado end-to-end con
  el esquema aplicado.
- Toolchain Vite+ 1.1.0: `vp lint` (0 errores, 21 warnings type-aware
  preexistentes: `no-floating-promises` ×20 y un `triple-slash-reference` en
  `src/env.d.ts`, convención de Astro), `vp fmt --check` limpio tras un pase
  de formato inicial sobre todo el repo.
- **Suite de tests portada a Vitest** (`vp test`, Vitest 5): 489 tests en 36
  archivos, todos verdes. Ver sección "Tests" abajo.
- CI de Node 26.10 restaurado en `.github/workflows/ci.yml`
  (check → lint → fmt → test → build).

## Tests

Los `*_test.ts` de Deno se portaron a Vitest colocados como `*.test.ts` junto
al código que prueban. Decisiones tomadas al cambiar de runtime/framework:

- **Harness**: `test/compat.ts` reimplementa los assertions de `@std/assert`
  sobre `expect` de Vitest, así los cuerpos de los tests quedaron verbatim
  (su valor está en los escenarios). Tests nuevos usan `expect` directo.
- **Stub de BD**: el import-map de Deno (`./lib/db.ts` → stub) se reemplazó
  por `vi.mock("@/lib/db", ...)` en `test/setup.ts` (vi.mock clava por id de
  módulo resuelto: cubre también los imports relativos `./db`).
- **Stub de supabase-js**: eliminado — existía porque el CI de Deno no podía
  instalar npm; con Node el paquete real está instalado y los tests nunca
  tocan red.
- **`ctx.state` → `ctx.locals`**: `test/helpers.ts` construye un `APIContext`
  falso (`locals`, `request`, `params`, `url`, `redirect`).
- **`pricing_test.ts`**: el handler GET de la página ya no existe como
  función (frontmatter de Astro), así que la lógica de sesión se extrajo a
  `src/lib/pricing.ts` y el test corre contra ella. Mismo patrón para el
  CSRF del middleware → `src/lib/csrf.ts`.
- **Tests nuevos por el cambio de runtime/framework**:
  `src/lib/env.test.ts` (accessor dual import.meta.env/process.env),
  `src/lib/db.test.ts` (fallback Postgres local `alapar` + decisión de SSL,
  con `pg` mockeado), `src/lib/csrf.test.ts` (matriz del CSRF reimplementado).

## Deploy: Cloudflare Workers (decisión asentada)

Se decidió desplegar en **Cloudflare Workers** (no Netlify, no VPS). Rationale:
free tier capaz de absorber la etapa temprana ( Workers ~100k req/día,
Hyperdrive ~500k queries/mes, KV/DO incluidos en free), salida natural al
problema del pooler (Hyperdrive mantiene un set acotado de conexiones y
cachea queries) y camino natural al push propio (Durable Objects) si algún
día se sustituye Supabase Realtime. Ver discusión: comparativa con Netlify
(Blobs) y Hetzner en la conversación de planeación.

Trabajo técnico de la migración (**hecho en el repo, pendiente de primer deploy**):

- ✅ Adapter `@astrojs/netlify` → `@astrojs/cloudflare` (con
  `platformProxy` para simular bindings en `astro dev`); `netlify.toml`
  eliminado. El adapter genera `dist/server/wrangler.json` al construir
  (hereda el `wrangler.toml` raíz; auto-provisiona el KV de SESSION —
  no usamos Astro sessions, es inofensivo).
- ✅ **Env vars, patrón estándar Workers**: vars no-secretas en
  `wrangler.toml [vars]` (SUPABASE_URL/ANON_KEY — públicas por diseño);
  secrets con `wrangler secret put`; `.dev.vars` para local (ver
  `.dev.vars.example`). `lib/env.ts` no cambió: con `nodejs_compat` los
  vars/secrets textuales poblan `process.env`.
- ✅ **Hyperdrive cableado**: `lib/db.ts` construye el pool de forma lazy
  con precedencia runtime-registration > `DATABASE_URL` > fallback local;
  el middleware (primero en la secuencia) registra
  `HYPERDRIVE.connectionString` una vez por aislado. Sin la binding
  activada, el fallback es conexión directa al pooler de Supabase.
- ✅ CI: job `deploy` manual (`workflow_dispatch`) que construye y corre
  `wrangler deploy -c dist/server/wrangler.json` (requiere secrets de repo
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).
- ⬜ Crear el Hyperdrive real (`wrangler hyperdrive create alapar-db
  --connection-string=…`) y descomentar la binding en `wrangler.toml`.
- ⬜ Subir los secrets (`wrangler secret put …`) y rellenar las vars
  públicas de `wrangler.toml`.
- ⬜ Verificar `pg` + TLS bajo `nodejs_compat` empíricamente y smoke
  post-deploy en `*.workers.dev` ANTES del cutover de dominio.

## Pendiente — cutover de dominio (Workers)

Con el sitio en su subdominio propio (`https://<sub>.<dominio>`, TBD):

1. **Dominio en Cloudflare vía subdominio**: los Custom Domains de Workers
   exigen que la **zona DNS viva en Cloudflare**. Si el dominio existente
   tiene el DNS en otro proveedor: agregar la zona en CF (plan free) y
   cambiar nameservers en el registrar (no hace falta transferir el
   registro). Luego crear el Custom Domain del Worker en el subdominio
   elegido. Usar `*.workers.dev` como entorno de pruebas previo.
2. **Google OAuth — no aplica en Google Cloud Console**: las redirect URIs
   del cliente de Google apuntan a `https://<ref>.supabase.co/auth/v1/callback`
   (fijas, no dependen del dominio del app). **Lo que sí aplica es en
   Supabase**: Auth → URL Configuration → agregar a las Redirect URLs
   `https://<sub>.<dominio>/auth/callback` y
   `https://<sub>.<dominio>/reset-password` (el cliente pasa
   `origin + "/auth/callback?next=…"` y `origin + "/reset-password"`),
   y actualizar el Site URL.
3. **Webhooks — la corrección: es Polar, no Supabase**: no existe en
   Supabase un "dominio autorizado para consumir webhooks" (lo único
   domain-bound allí es lo del punto 2). Lo que hay que recablear:
   - URL del webhook en el dashboard de **Polar** →
     `https://<sub>.<dominio>/api/webhooks/polar`.
   - Los **payment links** de Polar llevan la success URL configurada del
     lado de Polar (el checkout es un redirect a link, ver
     `api/billing/checkout.ts`) → apuntarla a
     `https://<sub>.<dominio>/billing/success`.
4. **PWA manifest y VAPID — casi nada que hacer**:
   - `public/manifest.json` usa solo rutas relativas (`start_url: "/"`,
     `scope: "/"`, íconos relativos) → **sin cambios**.
   - VAPID: el subject es `mailto:` y las llaves no están atadas al origen →
     **se reutilizan tal cual**, sin rotar nada.
   - Lo que SÍ es per-origin y no migra: push subscriptions (los usuarios
     re-suscriben silenciosamente al cargar el dashboard — el código ya lo
     hace; opcionalmente purgar endpoints muertos de `push_subscriptions`
     cuando empiecen a dar 410), cookies de sesión (todos re-inician
     sesión), IndexedDB snapshots y `localStorage` (`lastSplit_*`,
     `demo-tour-seen` — se regeneran solos).
5. **`COOKIE_SECURE`**: se infiere de producción; verificar tras el primer
   deploy del dominio nuevo.

## Pendiente — general

1. **Auth E2E**: las páginas autenticadas (`/dashboard/*`) no se han ejercido
   con sesión real contra Supabase.
2. **Web Push**: `lib/push.ts` usa WebCrypto global — en Workers es nativo
   (mejor que en Node), pero probarlo igual en staging.
3. **Docs**: `README*.md` y `MIGRATION.md` al día (Astro 7 + React 19 +
   Workers); `docs/ARCHITECTURE.md` aún arrastra detalles de la era
   Fresh/Deno en secciones no críticas; `docs/ROUTES.md` sin revisar.
4. **Rate limit**: el mapa en memoria es por aislado en Workers (como lo era
   por instancia en serverless); si se necesita límite global, mover a
   KV/DO (barato una vez ya en la plataforma).
5. **Revisar `gui-test-screenshots/`**: los flujos de billing (Polar
   checkout, portal) deben re-verificarse contra el despliegue nuevo.
6. **Warnings de `vp lint`**: ~22 warnings type-aware (mayoría
   `no-floating-promises` heredados del port + 1 `triple-slash-reference` en
   `src/env.d.ts`, que es la convención de Astro). Revisar los
   `no-floating-promises` uno a uno.
7. **Scripts de instalación bloqueados**: npm bloquea los postinstall de
   `esbuild` y `sharp` (allowScripts). La build funciona igual (esbuild trae
   binario precompilado); relevante solo si se adopta optimización de
   imágenes de Astro.

## Comandos

```bash
cd ../alapar-astro
npm install
npm run dev        # dev server
npm run build      # build SSR (Netlify; pendiente el swap a Cloudflare)
npm run check      # typecheck (astro check)
npm run lint       # Oxlint vía Vite+
npm run fmt        # Oxfmt vía Vite+ (fmt:check para verificar)
npm test           # Vitest vía Vite+
```
