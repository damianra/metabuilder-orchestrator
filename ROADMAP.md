# MetaBuilder — Roadmap v11

## Estado

v9–v10 completas y mergeadas: composición bidireccional
(front→`--extend`, back→diseñar attach), 3 tabs (Diseñar `#/` landing,
Backend `#/backend` chat experto, Fullstack `#/fullstack` form), chats
iterativos con propuestas clickeables en ambos lados, api-surface +
probe + lifecycle del dev-run, `menores` inferida por el agente.
Registro histórico: `docs/archive/ROADMAP-v1..v3.md`,
`docs/archive/ROADMAP-v4-v8.md` y `docs/archive/ROADMAP-v9-v10.md`.

## Visión v11

De **"un solo backend"** (express-sqlite fijo) a **"backend
configurable"**: el usuario elige su base de datos real (Postgres /
MySQL / MongoDB) o framework (NestJS) al crear — las conexiones quedan
establecidas con `.env` configurable y un CRUD de muestra, y el
experto/agente construye encima. El sistema ya es modular para esto:
`src/stacks/` es declarativo, `skeletonDir` está parametrizado y
`--stack-backend` ya fluye por el plan.

## Backlog v11 — multi-DB + multi-framework backend

| # | Tarea | Descripción | Esfuerzo |
| --- | --- | --- | --- |
| 1 ✅ | **Skeleton SQL genérico + stacks pg/mysql** — `templates/api-skeleton-sql/`: copia del api-skeleton con `server/db.js` que despacha `DB_DRIVER=pg\|mysql` (lazy-`import('pg')`/`import('mysql2/promise')`), pool + helper `q(text,params)` que normaliza placeholders `?`→`$1`; schema/seed por driver (`AUTO_INCREMENT` vs `GENERATED…IDENTITY`); `.env.example` con `DB_DRIVER/DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`. Registry: `express-postgres` + `express-mysql` (mismo `skeletonDir`, distinto driver default + requirements keywords `postgres`/`mysql` + `agentsStack` con dialecto explícito). Misma convención `server/routes/` → api-surface/probe/dev-run/attach funcionan sin cambios. CRUD de muestra `server/routes/items.js`. Verticales gateadas a `express-sqlite` (enqueue/CLI/form). | M |
| 2 ✅ | **Skeleton Mongo + stack** — `templates/api-skeleton-mongo/`: driver nativo, `db.js` exporta `client`/`db()`/`col(name)` leyendo `MONGO_URI` (+ `MONGO_DB`); `seedIfEmpty(col,docs)`; sin `schema.sql` (schemaless — validación opcional via `$jsonSchema`); routes `items.js` con `find/insertOne/updateOne/deleteOne`. Registry `express-mongo` con requirements `mongodb`. `.env.example` con `MONGO_URI`/`MONGO_DB`. | M |
| 3 | **Scanner por stack + detección** — `apiSurfaceFor` acepta `kind` del stack (`express-routes` por defecto; `nest-controllers` en #4). `detectStackId` para los stacks nuevos (pg/mysql/mongo por deps en package.json + db.js signature). `saveBackend` usa `detectStackId` en vez de `'express-sqlite'` fijo; AGENTS.md template parametriza la línea backend/DB hardcodeada (`{{backendStack}}`). Verticales orders/blog se gatean a `express-sqlite` (form/API rechazan vertical≠custom en stacks no-sqlite — overlays son express+sqlite-dialecto). | M |
| 4 | **NestJS skeleton + stack** — `templates/nest-skeleton/` (TS): `@nestjs/common/core/platform-express` + **TypeORM** (`DB_TYPE=postgres\|mysql\|mongodb\|sqlite` en `.env` → UN skeleton cubre todas las DBs vía DataSource); `src/items/{entity,service,controller,module}.ts` CRUD de muestra; `npm run api` (convención :4000 preservada), `npm test` vitest+supertest; docker con build stage (variante en `templates/docker` para stacks TS: `nest build`→`dist/`). Registry `nest-typeorm` con requirements `nestjs`/`typeorm`. Scanner `nest-controllers`: regex `@Controller\('(.)'\)` + `@(Get\|Post\|Put\|Patch\|Delete)\('(.)'\)` → mismo shape `{method,path,file}`. | L |
| 5 | **Backend tab multi-stack** — picker de stack al crear la sesión (`POST /api/backend {stack}` → `createBackend(stackId)` copia el skeleton del stack); prompt del experto por stack (`backend-designer-<id>.md` o placeholders dialecto/driver en el actual); status expone el stack activo. | S-M |

## Cross-cutting (por tarea)

- **`.env`**: toda var de conexión se declara en `.env.example` del
  skeleton — el usuario configura `DB_*`/`MONGO_URI`/`DB_TYPE` y el
  dev-run/app las toma (`dotenv/config` ya se carga).
- **Sin migraciones formales** por ahora: schema DDL idempotente al
  arranque (pg/mysql) o schemaless (mongo) — TypeORM `synchronize:
  env` ya da el equivalente para Nest.
- **Verify/docker**: `npm test` y `Dockerfile` se mantienen por
  convención; solo NestJS necesita build stage.
- **Verificación con DB real**: levantar `podman run` de
  postgres/mongo para smoke de conexión + CRUD — y **bajar el
  contenedor al terminar siempre**.

## Evaluación futura (fuera del roadmap por ahora)

- **Docker-compose generado**: la app + su DB en un compose para
  levantar todo local (hoy la DB es "del usuario", vía `.env`).
- **Migraciones** (knex/drizzle/typeorm-migrations) como paso de plan.
- **Dry-run del extender**, **aprobación de plan en dashboard**,
  **más engines ACP**, **chat nativo ACP**, **`session/resume` de
  opencode** (heredados de v9-v10, sin cambio).
- **Expo** para mobile (cambia contratos de verify/deploy).

## Decisiones tomadas (v11)

- **Express + DB paramétrica antes que NestJS**: el 80% del valor
  (DB real con `.env` + CRUD) viene con skeletons Express que
  reutilizan api-surface, dev-run, attach y el chat tal cual; NestJS
  es fase separada por el costo de TypeScript + build.
- **TypeORM en el skeleton Nest**: `DB_TYPE` env cubre
  postgres/mysql/mongo con un solo skeleton y un solo prompt — mejor
  que 3 stacks nest por DB.
- **Placeholders normalizados por helper, no por prompt**: `q()`
  traduce `?`→`$1` en runtime — el agente escribe un solo dialecto y
  el `agentsStack` documenta cuál; confiar en el prompt para
  dialectos falla silenciosamente.
- **Verticales quedan express-sqlite-only**: orders/blog son overlays
  de routes+schema SQLitesco — portarlos por driver es costo alto
  para poco uso; mejor gatear que emitir vertical rota.
- **La DB es del usuario** (`.env` con sus credenciales/host) — el
  orquestador no levanta DBs en la app generada; podman solo para
  pruebas de desarrollo del skeleton.
