# A la Par

[English](README.md) | **Español**

> Comparte gastos con tu pareja, amigos o roomies — y queden siempre _a la par_.

![Licencia](https://img.shields.io/badge/licencia-AGPLv3-blue)
![Demo](https://img.shields.io/badge/demo-en%20vivo-brightgreen)

**[▶ Prueba la demo guiada en vivo — sin registro](https://alapar.itzayanos.deno.net/demo)**
**App en vivo:** https://alapar.itzayanos.deno.net _(aún servida por la build
original de Fresh mientras aterriza esta migración)_

## Historia del proyecto

A la Par nació como un proyecto de **Deno**, construido sobre **Fresh**, el
framework web de Deno (Preact + islas renderizadas en servidor), y desplegado
en **Deno Deploy**. Cuando se anunció la adquisición de Deno por Cloudflare, el
proyecto fue portado a **Astro 7 sobre Node**, con Netlify como nuevo destino
de hosting. El código original de Fresh sigue en la rama `main`; la migración
vive en `migration/astro` — consulta [`MIGRATION.md`](MIGRATION.md) para el
mapa del port, el estado de verificación y lo que falta.

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
- **PWA instalable** — actualizaciones optimistas, caché con service workers,
  notificaciones push e instalación en Android y escritorio
- **Actualizaciones en tiempo real** — los cambios de otros miembros aparecen al
  instante vía Supabase Realtime

## Stack técnico

| Capa     | Tecnología                                                       |
| -------- | ---------------------------------------------------------------- |
| Frontend | Astro 7 + Preact (+ Signals), renderizado en servidor con islas  |
| Runtime  | Node.js 22.12+ (npm, Astro CLI; Vite 8 por debajo vía Vite+)     |
| Tooling  | Vite+ (`vp`) — lint (Oxlint), formato (Oxfmt), pruebas (Vitest)  |
| Backend  | Supabase — Postgres, Auth (email/contraseña + Google OAuth), RLS |
| Estilos  | Tailwind CSS + DaisyUI (tema oscuro)                             |
| Hosting  | Netlify (SSR vía @astrojs/netlify) — migración en curso          |
| Empaque  | PWA (web manifest + service worker + Web Push)                   |

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
- **Recuperación del canal en tiempo real** — si el WebSocket de Supabase
  Realtime se cae (expiración de token, corte de red, suspensión del móvil), el
  cliente obtiene automáticamente un token nuevo y se resuscribe con retroceso
  exponencial.
- **Seguridad en la base de datos** — Row-Level Security de Postgres aísla los
  datos de cada grupo; el canal de tiempo real solo entrega transacciones de los
  registros a los que pertenece el usuario autenticado.

## Correr en local

### Requisitos

- [Node.js](https://nodejs.org) 22.12+ y npm 9.6.5+
- Un proyecto de [Supabase](https://supabase.com) (el plan gratuito funciona) —
  o solo un Postgres local para desarrollo

### Instalación

```bash
git clone https://github.com/JS-Taiyou/alapar-fresh.git
cd alapar-fresh
git checkout migration/astro
npm install
cp .env.example .env   # agrega tus credenciales de Supabase y VAPID
```

**Base de datos.** Define `DATABASE_URL` con la URL del pooler de Supabase para
el backend completo. Sin `DATABASE_URL`, `src/lib/db.ts` cae a un Postgres
local en `postgresql://alapar:alapar@localhost:5432/alapar` — levántalo con
`docker compose up db` (o usa cualquier instalación local) y aplica
`db/schema.sql`. Para el proyecto de Supabase, corre las migraciones de `db/`
en el orden indicado en [`docs/DATABASE.md`](docs/DATABASE.md#migrations).

### Comandos

```bash
npm run dev        # servidor de desarrollo
npm run build      # build de producción (función SSR de Netlify)
npm run preview    # previsualiza la build
npm run check      # type-check (.astro + .ts vía astro check)
npm run lint       # Oxlint vía Vite+ (con tipos)
npm run fmt        # Oxfmt vía Vite+ (usa fmt:check para solo verificar)
npm test           # Vitest vía Vite+ (pasa mientras se porta la suite)
```

## Pruebas

La suite original de Deno (motor de saldos, repartos, validación de rutas,
stubs tipados de BD/Supabase) se está portando de `deno test` a **Vitest**
(corre con `npm test`, provisto por Vite+) — sigue disponible en `main` como
referencia. Ver [`MIGRATION.md`](MIGRATION.md).

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

- [ ] Completar la migración a Astro y mover el hosting a Netlify
- [ ] Publicación en Android vía TWA (Google Play)
- [ ] Dominio propio

## Licencia

AGPLv3 — consulta [LICENSE](LICENSE).
