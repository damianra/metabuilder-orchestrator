# MetaBuilder — Roadmap v13

## Estado

v12 completa y mergeada: toolchain por stack (enabler no-Node), stack
backend FastAPI, selector framework × DB en el dashboard y matriz
documentada — PRs #92-#95. v13 completa y mergeada: smoke runtime
post-build + fastapi-mongo — PRs #97/#98. Registro histórico:
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
| 1 | **Smoke runtime post-build** — `src/tools/smoke.js` + nodo en el grafo post-finalVerify: levanta `toolchain.devCmd`, `waitForPort`, y verifica el contrato: `GET /api/health` → 200; cada `GET` del `apiSurfaceFor` → no-404; `GET /api/*` inexistente → 404 JSON; si `dist/`/`out/` existe → `GET /` 200 + deep route → index.html (SPA fallback). Kill del proc tree al terminar — nunca huérfanos. **Severidad**: DB embebida (sqlite) → exigencia completa, falla = run `failed`; DB externa (postgres/mysql/mongo) → warn-only, solo wiring. Opt-out `plan.smoke === false` / `--no-smoke`. ~+15-30s por run. | M — **mergeado PR #97** |
| 2 | **`fastapi-mongo` — última celda de la matriz** — `templates/fastapi-skeleton-mongo/` (espejo de `api-skeleton-mongo`): ODMantic sobre Motor (`AsyncIOMotorClient`), `MONGO_URI`/`MONGO_DB` en `.env` (mismas vars que express-mongo), CRUD async `items`, tests con **mongomock-motor** (sin mongo real — self-contained). Stack def con `framework:'fastapi', dbs:['mongo']`, `detectPriority` menor que `fastapi` (gana el detect por `odmantic`/`motor`), convenciones del experto. Reusa `Dockerfile.python`/`fullstack-python` y el scanner `fastapi-routes`. | M — **mergeado PR #98** |
| 3 | **Smoke: 4xx = ruta montada** — los checks GET del smoke trataban todo status ≠200/404 como fallo → falso negativo strict en apps con auth (401/403 en endpoints protegidos mató un run real). `4xx ≠ 404` (401/403 auth, 400/422 validación) → `pass` "montada"; solo 404 = no montada, 5xx = error real. **mergeado PR #100** | XS |
| 4 | **UI dashboard: texto legible + data-testid** — la clase `input` de `NewAppForm` no declaraba `text-*` → letras negras sobre `bg-slate-900`. Fix `text-slate-200 placeholder:text-slate-500` + `data-testid` en los controles clave (newapp-submit, design-*, backend-*, project-*) para automatización (Playwright/e2e de la propia UI) — los icon-buttons solo tenían `title` (tooltip, no accessible name). **mergeado PR #100** | S |
| 5 | **Fullstack × NestJS** — nest deja de ser backend-only: skeleton reestructurado `src/`→`server/` (colisión con `src/` de vite), tsc emite a `dist-server/` (colisión con `dist/` del build), SPA serving por express adapter (static `dist/` + catchall no-/api → index.html), `build:api` como script propio (el merge preflight da el `build` a vite), `Dockerfile.fullstack-ts`, api-surface escanea `server/`+`src/` legacy, fuera el guard de server y el disabled del form. **mergeado PR #101** | M |

| 6 | **AGENTS.md stack-conditional** — la sección backend del AGENTS.md generado era express-específica (`server/routes` auto-mount, `server/index.js`, uploads) aun cuando la app era nest/fastapi → un agente que retomara la app leía convenciones equivocadas. Placeholder `{{backendNotes}}` renderizado desde `agentsNotes` por stack def. | S |
| 7 | **nextjs E2E verify** — `nextjs` figura en el selector de front pero ningún run real lo ejercitó post-`@OUT_DIR@` (`out/` vs `dist/` en smoke/Dockerfile). Correr una generación fullstack con `--stack-frontend nextjs` y verificar buildDir/serve/docker. **verificado E2E — `gastos-next` done (smoke SPA ✓, `out/` servida, e2e propia 8/8 + validación Playwright manual)** | S |
| 8 | **Modal de confirmación de delete** — `ProjectDetail.del()` usaba `window.confirm()` nativo (rompe el tema oscuro, no estilable, choca con la UI). Modal propio con el estilo del panel "Agregar backend" (overlay `bg-slate-900/40`, panel `ring-red-500/40`, Cancelar/Eliminar con busy-state + testids). | XS |

## Límites conocidos (documentados — no accionables hoy)

- **Catchall SPA vs prefijo `/api`**: una ruta del front tipo `/api-docs` matchea `startsWith('/api')` → 404 del backend en vez de index.html. La convención del experto evita ese prefijo.
- **Controllers nest fuera de `/api`**: sombreados por el catchall — la convención exige `@Controller('api/...')` (documentado en `server/main.ts`).
- **Smoke**: rutas GET parametrizadas no verificables sin id seed (skip + warn); si una app tuviera auth global, el check "unknown → 404" vería 401 (ningún skeleton genera auth global hoy).
- **api-surface nest** también escanea `src/` en fullstack (donde `src/` es el front) — inocuo: vite nunca produce `*.controller.ts`.

## Matriz framework × DB (objetivo v13)

| | sqlite | postgres | mysql | mongo |
| --- | --- | --- | --- | --- |
| **Express** | `express-sqlite` | `express-postgres` | `express-mysql` | `express-mongo` |
| **NestJS** | — | `nest-typeorm` | `nest-typeorm` | `nest-typeorm` |
| **FastAPI** | `fastapi` | `fastapi` | `fastapi` | `fastapi-mongo` |

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
