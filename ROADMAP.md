# MetaBuilder — Roadmap v13

## Estado

v12 completa y mergeada: toolchain por stack (enabler no-Node), stack
backend FastAPI, selector framework × DB en el dashboard y matriz
documentada — PRs #92-#95. Registro histórico:
`docs/archive/ROADMAP-v1.md` … `ROADMAP-v12.md`.

## Visión v13

**Robustez validada, no más tecnologías.** El scope de stacks queda
cerrado — el valor está en que las apps generadas salgan verificadas
de verdad en el mismo tiempo: el pipeline levanta la app recién
creada y le pega a sus endpoints reales (hoy la verificación es
estática; el wiring solo se validaba a mano). Se cierra además la
última celda de la matriz (fastapi+mongo) porque quedó aplazada en
v12, no porque se abra una nueva dirección.

## Backlog v13

| # | Tarea | Esfuerzo |
| --- | --- | --- |
| 1 | **Smoke runtime post-build** — `src/tools/smoke.js` + nodo en el grafo post-finalVerify: levanta `toolchain.devCmd`, `waitForPort`, y verifica el contrato: `GET /api/health` → 200; cada `GET` del `apiSurfaceFor` → no-404; `GET /api/*` inexistente → 404 JSON; si `dist/`/`out/` existe → `GET /` 200 + deep route → index.html (SPA fallback). Kill del proc tree al terminar — nunca huérfanos. **Severidad**: DB embebida (sqlite) → exigencia completa, falla = run `failed`; DB externa (postgres/mysql/mongo) → warn-only, solo wiring. Opt-out `plan.smoke === false` / `--no-smoke`. ~+15-30s por run. | M |
| 2 | **`fastapi-mongo` — última celda de la matriz** — `templates/fastapi-skeleton-mongo/` (espejo de `api-skeleton-mongo`): ODMantic sobre Motor (`AsyncIOMotorClient`), `MONGO_URI`/`MONGO_DB` en `.env` (mismas vars que express-mongo), CRUD async `items`, tests con **mongomock-motor** (sin mongo real — self-contained). Stack def con `framework:'fastapi', dbs:['mongo']`, `detectPriority` menor que `fastapi` (gana el detect por `odmantic`/`motor`), convenciones del experto. Reusa `Dockerfile.python`/`fullstack-python` y el scanner `fastapi-routes`. | M |

## Matriz framework × DB (objetivo v13)

| | sqlite | postgres | mysql | mongo |
| --- | --- | --- | --- | --- |
| **Express** | `express-sqlite` | `express-postgres` | `express-mysql` | `express-mongo` |
| **NestJS** (backend-only) | — | `nest-typeorm` | `nest-typeorm` | `nest-typeorm` |
| **FastAPI** | `fastapi` | `fastapi` | `fastapi` | `fastapi-mongo` (#2) |

## Reglas del smoke (requisito del workflow)

- **La validación nunca depende de servicios/credenciales externos** —
  con DB postgres/mysql/mongo el smoke verifica solo wiring (boot +
  rutas montadas + SPA), nunca exige que la DB responda. Seguridad
  primero: sin `.env` real no hay falsos negativos ni riesgo de tocar
  datos vivos.
- **DB embebida = exigencia completa** — sqlite no tiene excusa: si
  el smoke falla ahí, el run falla.
- **Sin procesos huérfanos** — kill del tree siempre, igual que los
  dev-runs del dashboard (misma disciplina de `on('error')` en logs).
- **Desactivable pero por defecto ON** — `plan.smoke === false` /
  `--no-smoke` para quien quiera el pipeline viejo.

## Decisiones tomadas (v13)

- **ODMantic sobre Motor** para mongo: modelos declarativos +
  validación pydantic — el experto escribe casi igual que en el path
  SQL. pymongo sync queda descartado (bloquea el event loop); Motor
  crudo sin ODM fuerza una capa de datos ajena al patrón.
- **Tests con mongomock-motor** — preserva la promesa del skeleton:
  los tests corren sin servicios externos.
- **`fastapi-mongo` como stackId separado** — espejo de
  `express-mongo`; `resolveBackendStackId('fastapi','mongo')` resuelve
  sin tocar el registry. La detección gana por `odmantic`/`motor` en
  requirements (prioridad mayor que `fastapi` puro — mismo patrón
  nest-vs-mongo de v12).
- **No más stacks nuevos** — el scope de frameworks queda cerrado;
  el foco siguiente es profundidad de verificación, no amplitud de
  matriz.
