# Migración a Astro (rama `migration/astro`, worktree `../alapar-astro`)

Estado: **port completo del código — pendiente de hardening y despliegue.**

La app Deno Fresh original sigue intacta en la rama `main` (worktree
`../alapar-fresh`). Esta rama reemplaza Deno + Fresh + Deno Deploy por
**Astro 7 + Preact + adaptador Netlify**, manteniendo Supabase (auth +
Postgres). El toolchain de lint/formato/tests es **Vite+ (`vp`)**: Vite 8
(queda fijado a `@voidzero-dev/vite-plus-core` vía override de npm), Oxlint,
Oxfmt y Vitest.

## Qué se hizo

| Área                                                | Origen (Fresh)                         | Destino (Astro)                                      |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| Shell HTML                                          | `routes/_app.tsx`                      | `src/layouts/Base.astro`                             |
| Middleware (csrf, headers, rate limit, auth, guard) | `main.ts`                              | `src/middleware.ts` (`context.locals` ≈ `ctx.state`) |
| Lógica de negocio                                   | `lib/*.ts`                             | `src/lib/*.ts` (sin tests, ver pendientes)           |
| Páginas                                             | `routes/**.tsx`                        | `src/pages/**.astro`                                 |
| API                                                 | `routes/api/**.ts` (`define.handlers`) | `src/pages/api/**.ts` (`APIRoute` por método)        |
| Islands (Preact)                                    | `islands/*.tsx`                        | `src/islands/*.tsx` + `client:load`                  |
| Componentes                                         | `components/*.tsx`                     | `src/components/*.tsx`                               |
| Estáticos                                           | `static/`                              | `public/`                                            |
| Demo data                                           | `data/demo.json`                       | `src/data/demo.json`                                 |
| 404                                                 | `app.notFound`                         | `src/pages/404.astro`                                |

Cambios estructurales notables:

- **Env vars**: `src/lib/env.ts` lee `import.meta.env` con fallback a
  `process.env` (dev Vite vs runtime Netlify).
- **Postgres local**: sin `DATABASE_URL`, `src/lib/db.ts` cae a
  `postgresql://alapar:alapar@localhost:5432/alapar` (sin SSL).
  `docker-compose.yml` incluido por si no hay Postgres local; el esquema se
  aplica con `db/schema.sql` (los `add_*.sql` son incrementales históricos).
- **Señales de página**: Fresh creaba signals en páginas servidor; Astro no
  puede serializarlas, así que `demo` y `dashboard/index` se convirtieron en
  islands de página completa (`src/islands/DemoApp.tsx`, `DashboardHome.tsx`).
- **CSRF**: el plugin `csrf()` de Fresh se reimplementó inline en el
  middleware (excepción `/api/webhooks/polar` preservada).
- **Alias `@/*` → `src/*`** configurado en `tsconfig.json`.

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

## Pendiente

1. **Auth E2E**: las páginas autenticadas (`/dashboard/*`) no se han ejercido
   con sesión real contra Supabase.
2. **Web Push**: `lib/push.ts` usa WebCrypto global — funciona en Node 20+,
   pero hay que probarlo en el runtime de Netlify Functions.
3. **Despliegue Netlify**: conectar repo, definir env vars
   (`DATABASE_URL`, `SUPABASE_*`, `VAPID_*`, `POLAR_*`), y actualizar:
   - URL del webhook en el dashboard de Polar → `https://<sitio>/api/webhooks/polar`
   - Redirect URLs de Supabase Auth (Site URL / callback) al dominio nuevo
   - `COOKIE_SECURE` se infiere de producción; verificar tras el primer deploy
4. **Docs**: los `README*.md` ya describen el stack Astro 7 + Vite+; los
   `docs/*.md` aún son de la era Deno/Fresh — reescribir.
5. **Rate limit**: el mapa en memoria es por instancia de función en Netlify
   (igual que por aislado en Deno Deploy); si se necesita límite global,
   mover a Netlify Blobs/Upstash.
6. **Revisar `gui-test-screenshots/`**: los flujos de billing (Polar checkout,
   portal) deben re-verificarse contra el despliegue de Netlify.
7. **Preact 11**: aplazado — `@astrojs/preact` 6.x declara peer
   `preact ^10.6.5`, así que se queda en Preact 10.29.8 hasta que la
   integración soporte la 11.
8. **Warnings de `vp lint`**: 21 warnings type-aware (20 `no-floating-promises`
   en islands + 1 `triple-slash-reference` en `src/env.d.ts`, que es la
   convención de Astro). Revisar los `no-floating-promises` uno a uno.
9. **Scripts de instalación bloqueados**: npm bloquea los postinstall de
   `esbuild` y `sharp` (allowScripts). La build funciona igual (esbuild trae
   binario precompilado); si se adopta optimización de imágenes de Astro,
   aprobar `sharp`.

## Comandos

```bash
cd ../alapar-astro
npm install
npm run dev        # dev server
npm run build      # build SSR (Netlify)
npm run check      # typecheck (astro check)
npm run lint       # Oxlint vía Vite+
npm run fmt        # Oxfmt vía Vite+ (fmt:check para verificar)
npm test           # Vitest vía Vite+
```
