# MetaBuilder — Roadmap v12

## Estado

v11 completa y mergeada: multi-DB + multi-framework backend
(`express-sqlite|postgres|mysql|mongo`, `nest-typeorm`), scanner por
stack, AGENTS.md parametrizado, Backend tab multi-stack. Post-v11
mergeados: restyle dashboard retro-gamer, screenshot en README,
nest+mongo, instrucciones JWT del experto. Registro histórico:
`docs/archive/ROADMAP-v1.md` … `ROADMAP-v11.md`.

## Visión v12

Backend configurable **de verdad**: el usuario elige **framework**
(Express / NestJS / FastAPI) y **base de datos** (sqlite / postgres /
mysql / mongo) como dimensiones independientes en el form Fullstack y
en el Backend tab — no un combo cerrado por stack-id. El pipeline deja
de asumir npm para poder operar stacks no-Node.

## Backlog v12

| # | Tarea | Esfuerzo |
| --- | --- | --- |
| 1 | **Toolchain por stack (enabler)** — el stack def gana `toolchain`: `{installCmd, testCmd, devCmd, buildCmd, dockerfile, manifest}`. Preflight (`npm install`), verify (`npm test`/`build`), dev-run (`npm run api`), finalize y `detectBackendStackId` lo leen en vez de hardcodear npm/package.json. Stacks Node conservan su toolchain npm — refactor interno invisible. Sin esto no hay stack no-Node posible. | M-L — **mergeado PR #92** |
| 2 | **FastAPI skeleton + stack** — `templates/fastapi-skeleton/`: `app/main.py` (FastAPI + CORS + static `dist/` si existe), `app/routers/items.py` CRUD, `app/db.py` SQLAlchemy + `DATABASE_URL` en `.env` (sqlite default; postgres/mysql por URL), `requirements.txt`, `tests/` pytest, `.env.example`, `Dockerfile.python` (uvicorn :4000 — convención preservada). Scanner `fastapi-routes` (decorators `@router.get\|post\|put\|delete`). Detección por `requirements.txt`/`pyproject`. Stack def `fastapi` con toolchain python + convenciones del experto. | L — **mergeado PR #93** |
| 3 | **Selector framework × DB** — `stack back` del form Fullstack y del picker del Backend tab se separan en **2 selects**: framework (`express\|nest\|fastapi`) y DB (`sqlite\|postgres\|mysql\|mongo`, filtrada por compat). Registry: `stacks.backend` resuelve `(framework,db) → stackId`; back-compat `--stack-backend express-sqlite` → `(express,sqlite)`. `createBackend(framework,db)`, `backend-state.json` guarda ambos, api-surface por framework, Dockerfile por toolchain. | M-L — **mergeado PR #94** |
| 4 | **Docs + matriz** — README/docs de la matriz framework×DB real; verticales siguen express-sqlite-only; `django` queda fuera (monolítico, no API-first — ver decisiones). | S |

## Matriz framework × DB (real, post-v12)

| | sqlite | postgres | mysql | mongo |
| --- | --- | --- | --- | --- |
| **Express** | ✓ `express-sqlite` | ✓ `express-postgres` | ✓ `express-mysql` | ✓ `express-mongo` |
| **NestJS** | — (backend-only) | ✓ `nest-typeorm` | ✓ `nest-typeorm` | ✓ `nest-typeorm` (`@ObjectIdColumn`) |
| **FastAPI** | ✓ `fastapi` | ✓ `fastapi` (`DATABASE_URL`) | ✓ `fastapi` | fase 2 — `motor` driver, fuera de v12 |

Cada celda es el stackId que `resolveBackendStackId(fw, db)` devuelve;
los 2 selects del form Fullstack y del Backend tab consumen
`backendMatrix()` de `GET /api/options`.

## Registro post-v11 (mergeados)

| # | Tarea | Estado |
| --- | --- | --- |
| A | Dashboard temas por área + restyle | mergeado PR #83 |
| B | Dashboard retro-gamer + polish | mergeado PRs #84/#85 |
| C | Screenshot en README de apps | mergeado PR #86 |
| D | NestJS + MongoDB en `nest-typeorm` | mergeado PR #88/#89 |
| E | Instrucciones JWT en el experto backend | mergeado PR #90 |

## Decisiones tomadas (v12)

- **FastAPI sí, Django no**: FastAPI es API-first (encaja con
  "backend para un front React"); Django es monolítico (templates,
  admin) — pelea contra el modelo del producto.
- **El toolchain por stack se paga primero**: verify/install/dev-run/
  docker acoplados a npm son la deuda real — sin esa abstracción,
  FastAPI sería un frankenstein, no un stack.
- **Mongo en FastAPI queda fuera de v12**: `motor` añade async
  surface distinta — SQL via `DATABASE_URL` cubre el 90% del caso.
- **Framework×DB como dimensiones, no combos cerrados**: más
  libertad al usuario (su pedido explícito) y el registry queda
  matricial en vez de una lista creciente de `framework-db` ids.
