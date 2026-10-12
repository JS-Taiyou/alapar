# Migración a Astro (rama `migration/astro`, worktree `../alapar-astro`)

Estado: **port completo del código — pendiente de hardening y despliegue.**

La app Deno Fresh original sigue intacta en la rama `main` (worktree
`../alapar-fresh`). Esta rama reemplaza Deno + Fresh + Deno Deploy por
**Astro 5 + Preact + adaptador Netlify**, manteniendo Supabase (auth + Postgres).

## Qué se hizo

| Área | Origen (Fresh) | Destino (Astro) |
|---|---|---|
| Shell HTML | `routes/_app.tsx` | `src/layouts/Base.astro` |
| Middleware (csrf, headers, rate limit, auth, guard) | `main.ts` | `src/middleware.ts` (`context.locals` ≈ `ctx.state`) |
| Lógica de negocio | `lib/*.ts` | `src/lib/*.ts` (sin tests, ver pendientes) |
| Páginas | `routes/**.tsx` | `src/pages/**.astro` |
| API | `routes/api/**.ts` (`define.handlers`) | `src/pages/api/**.ts` (`APIRoute` por método) |
| Islands (Preact) | `islands/*.tsx` | `src/islands/*.tsx` + `client:load` |
| Componentes | `components/*.tsx` | `src/components/*.tsx` |
| Estáticos | `static/` | `public/` |
| Demo data | `data/demo.json` | `src/data/demo.json` |
| 404 | `app.notFound` | `src/pages/404.astro` |

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

- `npx astro check`: 0 errores, 0 warnings (109 archivos).
- `npx astro build`: OK, función SSR de Netlify generada.
- Smoke test dev: `/login`, `/pricing`, `/demo`, `/join/:code` → 200;
  `/` y `/dashboard` → 302 a `/login` (guard); `/api/*` sin sesión → 401 JSON.
- Fallback Postgres local (`alapar`/`alapar`/`alapar`) probado end-to-end con
  el esquema aplicado.

## Pendiente

1. **Tests**: los `*_test.ts` de Deno no se portaron. Hay que migrarlos a
   `vitest` (o `node:test`) y re-crear el harness de `test/helpers.ts`.
2. **Auth E2E**: las páginas autenticadas (`/dashboard/*`) no se han ejercido
   con sesión real contra Supabase.
3. **Web Push**: `lib/push.ts` usa WebCrypto global — funciona en Node 20+,
   pero hay que probarlo en el runtime de Netlify Functions.
4. **Despliegue Netlify**: conectar repo, definir env vars
   (`DATABASE_URL`, `SUPABASE_*`, `VAPID_*`, `POLAR_*`), y actualizar:
   - URL del webhook en el dashboard de Polar → `https://<sitio>/api/webhooks/polar`
   - Redirect URLs de Supabase Auth (Site URL / callback) al dominio nuevo
   - `COOKIE_SECURE` se infiere de producción; verificar tras el primer deploy
5. **Docs**: `README*.md` y `docs/*.md` aún describen Deno/Fresh — reescribir.
6. **CI**: se borró `.github/workflows/ci.yml` (Deno); crear workflow de Node
   (`npm ci && npx astro check && npm run build`).
7. **Rate limit**: el mapa en memoria es por instancia de función en Netlify
   (igual que por aislado en Deno Deploy); si se necesita límite global,
   mover a Netlify Blobs/Upstash.
8. **Revisar `gui-test-screenshots/`**: los flujos de billing (Polar checkout,
   portal) deben re-verificarse contra el despliegue de Netlify.

## Comandos

```bash
cd ../alapar-astro
npm install
npm run dev        # dev server
npm run build      # build SSR (Netlify)
npx astro check    # typecheck
```
