# A la Par

[English](README.md) | **Español**

> Comparte gastos con tu pareja, amigos o roomies — y queden siempre _a la par_.

[![CI](https://github.com/JS-Taiyou/alapar/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JS-Taiyou/alapar/actions/workflows/ci.yml)
![Licencia](https://img.shields.io/badge/licencia-AGPLv3-blue)
![Demo](https://img.shields.io/badge/demo-en%20vivo-brightgreen)

**[▶ Prueba la demo guiada en vivo — sin registro](https://alapar.jorjoso.dev/demo)**
**App en vivo:** https://alapar.jorjoso.dev

## Historia del proyecto

A la Par nació como un proyecto de **Deno**, construido sobre **Fresh**, el
framework web de Deno (Preact + islas renderizadas en servidor), y desplegado
en **Deno Deploy**. Cuando se anunció la adquisición de Deno por Cloudflare, el
proyecto fue portado a **Astro 7 + React 19**, desplegado en Cloudflare Workers
El código de Fresh vive en el historial de git (pre-`6b9a4d3` en `main`);
consulta [`MIGRATION.md`](MIGRATION.md) para el mapa del port y lo que falta.

## ¿Qué es?

A la Par es una PWA full-stack para dividir gastos, hecha para usuarios
hispanohablantes. Crea un registro, anota gastos y pagos, y la app mantiene el
balance actualizado de quién le debe a quién — incluyendo compras a meses,
cargos recurrentes y pagos directos entre miembros.

- **Registros para cualquier contexto** — parejas, roomies, viajes; cada usuario
  puede pertenecer a varios grupos
- **Meses y cargos recurrentes** — sigue los pagos restantes de cada compra a
  plazos y las suscripciones vigentes
- **Cálculo automático de saldos** — balancea pagos entre cualquier par de
  miembros
- **Corte de ejercicio** — archiva las transacciones del periodo y empieza en
  ceros; los saldos pendientes se arrastran como transacciones de apertura para
  que nada se pierda
- **Historial con búsqueda** — busca ejercicios cerrados por nombre y
  consúltalos cuando quieras
- **Interfaz bilingüe** — español/inglés con un selector por usuario
- **PWA instalable** — actualizaciones optimistas, caché con service workers
  e instalación en Android y escritorio
- **Sincronización por versiones** — los cambios de otros miembros llegan vía
  un chequeo horario de versión contra un espejo KV en el edge (barato: sin
  tocar la base de datos cuando nada cambió), con refresco inmediato al
  enfocar la app

## Stack técnico

| Capa     | Tecnología                                                           |
| -------- | -------------------------------------------------------------------- |
| Frontend | Astro 7 + React 19, renderizado en servidor + componentes hidratados |
| Runtime  | Node.js 22.12+ (npm, Astro CLI; Vite 8 por debajo vía Vite+)         |
| Tooling  | Vite+ (`vp`) — lint (Oxlint), formato (Oxfmt), pruebas (Vitest)      |
| Backend  | Supabase — Postgres, Auth (email/contraseña + Google OAuth), RLS     |
| Estilos  | Tailwind CSS + DaisyUI (tema oscuro)                                 |
| Hosting  | Cloudflare Workers (alapar.jorjoso.dev) — deploy automático vía CI   |
| Empaque  | PWA (web manifest + service worker + Web Push)                       |

## Detalles de ingeniería

- **Aritmética monetaria en centavos enteros** — el motor de repartos y los
  deltas de saldo persistidos usan aritmética exacta en centavos, y la API
  valida que las partes sumen el monto total antes de guardar nada.
- **Reparto determinista del sobrante** — cuando una división no es exacta, los
  centavos restantes se asignan de forma reproducible (sembrados con un UUID por
  transacción): saldos auditables y justos en agregado.
- **Persistencia exacta de saldos** — los deltas por usuario se guardan como
  `NUMERIC(12,2)` en una tabla `transaction_balances` y se suman con aritmética
  exacta de SQL, eliminando las discrepancias de 1-2 centavos que se acumulan
  con totales flotantes. Las escrituras multi-paso (transacción + pagos +
  deltas, uniones por invitación, clonación por lotes) corren dentro de
  transacciones de BD, así que una falla parcial no deja saldos inconsistidos.
- **Sync sin conexiones pegajosas** — el cliente compara un sello de versión
  (fuente: Postgres) espejado en Workers KV; si no cuadra, paga un refetch
  completo; si cuadra, cuesta una lectura de KV de milisegundos. Tus propias
  mutaciones devuelven su sello en la respuesta, así que nunca te disparan un
  refetch a ti mismo.
- **Seguridad en la base de datos** — Row-Level Security de Postgres aísla los
  datos de cada grupo; la capa de API solo consulta registros a los que
  pertenece el usuario autenticado.

## Correr en local

### Requisitos

- [Node.js](https://nodejs.org) 22.12+ y npm 9.6.5+ con una instalación
  local de [PostgreSQL](https://www.postgresql.org) — un proyecto de
  [Supabase](https://supabase.com) (plan gratuito) solo se necesita para el
  backend completo de auth/billing

### Loop de desarrollo sin configuración (sin Supabase)

El dev server corre 100% contra Postgres local — sin Supabase, sin OAuth,
sin Polar, sin credenciales:

```bash
git clone https://github.com/JS-Taiyou/alapar.git
cd alapar
npm install
npm run db:schema           # aplica db/schema.sql al Postgres local
npm run db:seed             # opcional: usuarios y registros demo
npm run dev                 # http://localhost:4321
```

En `/login`, **cualquier contraseña es válida** — el email que escribas
encuentra (o crea al primer uso) la cuenta en la base local, y la sesión vive
en una cookie exclusiva de dev. El botón de Google, los links de recuperación
y todo punto de contacto con Supabase quedan ocultos en dev. Usuarios del
seed: `john@example.com`, `jane@example.com`, `bob@example.com`. Para iterar
el flujo real de Supabase en local, pon `DEV_AUTH=off` en `.env`.

Los scripts (y la app) usan por defecto un Postgres local en
`postgresql://alapar:alapar@localhost:5432/alapar` — créalo una vez con
`create role alapar login password 'alapar'; create database alapar owner alapar;`
o apunta `DATABASE_URL` a cualquier instancia local. Re-correr `db:schema` /
`db:seed` sobre una base poblada es un no-op seguro.

**Backend completo (Supabase).** Define `DATABASE_URL` con la URL del pooler
más las vars `SUPABASE_*` de `.env.example`. Para el proyecto de Supabase,
corre las migraciones de `db/` en el orden de
[`docs/DATABASE.md`](docs/DATABASE.md#migrations). Los endpoints de billing
quedan inertos (503) sin vars `POLAR_*` — la página de precios renderiza
igual.

### Comandos

```bash
npm run dev        # servidor de desarrollo
npm run build      # build de producción (Cloudflare Workers)
npm run preview    # previsualiza la build
npm run check      # type-check (.astro + .ts vía astro check)
npm run lint       # Oxlint vía Vite+ (con tipos)
npm run fmt        # Oxfmt vía Vite+ (usa fmt:check para solo verificar)
npm test           # Vitest vía Vite+ (pasa mientras se porta la suite)
```

## Pruebas

```bash
npm test           # suite Vitest (489 tests, BD simulada — sin DATABASE_URL)
```

La suite cubre el motor de saldos y repartos (las partes siempre suman el
total, desviación ≤ un centavo, repartos deterministas), los handlers de ruta
(contra una capa de queries simulada) y el nuevo comportamiento del runtime
tras la migración (accessor de env, fallback a Postgres local, CSRF
reimplementado). Ver [`MIGRATION.md`](MIGRATION.md#tests) para las notas del
port Deno→Vitest.

## Documentación

- [`MIGRATION.md`](MIGRATION.md) — mapa del port Fresh → Astro y trabajo
  pendiente
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitectura del sistema,
  estructura de directorios, flujo de auth, caché, tiempo real
- [`docs/BUSINESS_LOGIC.md`](docs/BUSINESS_LOGIC.md) — cálculo de saldos, modos
  de división, corte/asentamiento, arrastre, invitaciones
- [`docs/DATABASE.md`](docs/DATABASE.md) — esquema, tablas, migraciones
- [`docs/ROUTES.md`](docs/ROUTES.md) — inventario de rutas
- [`docs/ISLANDS.md`](docs/ISLANDS.md) — componentes interactivos
- [`docs/COMPONENTS.md`](docs/COMPONENTS.md) — componentes presentacionales
- [`docs/MONETIZATION.md`](docs/MONETIZATION.md) — diseño del plan Pro y runbook
  de Polar
- [`CHANGELOG.md`](CHANGELOG.md) — registro de cambios significativos

_Nota: `docs/*.md` aún describe la arquitectura de Fresh y se irá actualizando
como parte de la migración._

## Próximos pasos

- [x] Portar a Astro 7 + React 19 y desplegar en Cloudflare Workers
- [ ] Publicación en Android vía TWA (Google Play)
- [x] Dominio propio (alapar.jorjoso.dev)

## Licencia

AGPLv3 — consulta [LICENSE](LICENSE).
