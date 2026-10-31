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
| 8 | **Modal de confirmación de delete** — `ProjectDetail.del()` usaba `window.confirm()` nativo (rompe el tema oscuro, no estilable, choca con la UI). Modal propio con el estilo del panel "Agregar backend" (overlay `bg-slate-900/40`, panel `ring-red-500/40`, Cancelar/Eliminar con busy-state + testids). **mergeado PR #104 + anchor top PR #105** | XS |
| 9 | **`items` de muestra: política de reemplazo** — el CRUD de muestra del skeleton quedaba a juicio del agente (en `gastos-nest` sobrevivió `server/items/` junto al dominio real → `/api/items` vivo o archivos muertos). Política: **reemplazar** — el agente debe rename/refactor la muestra al recurso real del dominio (o eliminarla entera si no aplica): `/api/items` no debe llegar a la app final. Instrucción en los 7 `requirements[].prompt` (pipeline) + las 6 `CONVENTIONS` del experto (workspace). **mergeado PR #106** | XS |
| 10 | **Component kit pre-styled en app-skeleton** — el front hoy escribe Tailwind desde cero bajo reglas de prosa → calidad variable + tokens en CSS improvisado. `components/ui/` con bloques genéricos (Hero, Navbar, Section, Card, StatCard, EmptyState, ErrorState, FormShell, CTA) que el agente compone/parametriza en vez de re-implementar → piso de calidad consistente, menos `verify` fallidos (menos retrabajos del fixer). Convención: el experto extiende sobre el kit, no lo reescribe. **mergeado PR #115** | M |
| 11 | **State pattern front (convención, no Redux)** — las apps quedan con `useState` + fetch inline suelto. Documentar en AGENTS.md/conventions: `lib/api.js` como cliente único, `useState` local, `useReducer` para flujos multi-paso. Sin librería de estado (fuera de scope: rápido, funcional, fácil de conectar). **mergeado PR #110** | XS |
| 12 | **Smoke antes de review** — hoy `finalVerify → review → smoke`: un review a una app que no bootea es token gastado en vano. Mover el nodo smoke antes de review (o dentro del finalVerify) → el gate determinístico descarta temprano; el review (caro) solo corre sobre apps que arrancan. **mergeado PR #108** | XS |
| 13 | **Contract test por endpoint (api-surface)** — el agente escribe tests por endpoint con tokens y variabilidad. Auto-generar durante build/finalize un test por ruta del `apiSurfaceFor` (`GET` → no-404/`2xx`) → cobertura determinística del wiring UI↔API gratis; el agente solo escribe tests de dominio. **mergeado PR #111** | S |
| 14 | **Screenshot al review** — la `screenshot.png` se genera en finalize POST-review → el QA agent es ciego visual (hero vacío, contraste, layout roto pasa). Adelantar el capture al review (pre-approve) + pasarlo como evidencia → salto de cobertura visual. **mergeado PR #113** | M |
| 15 | **Review scoped al diff** — el review puede releer todo el proyecto por paso. Limitar su input a archivos tocados por el paso + imports frontera → tokens por review bajan sin perder cobertura en lo nuevo (los checks estáticos cubren el resto). **mergeado PR #112** | S |
| 16 | **Prompt pruning por relevancia** — hoy inyectamos TODO el AGENTS.md + convenciones en cada llamada (WhatsApp en apps sin WhatsApp, DB externa en sqlite, compliance de pagos sin pagos). Gatear secciones por `appType`/`scope`/`stack` real → ~30-40% menos texto por llamada al agente, mismo output. El template ya se arma por partes — falta el selector. **mergeado PR #114** | S |
| 17 | **Granularidad del plan** — 6 pasos = 6 ciclos build+verify con overhead de contexto/verify por paso. El planner podría agrupar pasos triviales (scaffolding + componente simple) → menos ciclos = menos tokens re-cargados. Balance: atomicidad para fix/resume. **mergeado PR #116** | S |
| 18 | **Extend acelerado + selector de stack** — `add-backend` corría pipeline completo con el agente infiriendo la API (lento, fallas de wiring) y solo express-sqlite en el modal. `frontApiScan` extrae los endpoints que el front YA llama → `{{frontContract}}` en el prompt extend (implementa la spec, no adivina); modal con select de stack backend (express/nest/fastapi × db) + `/api/options` `backendStacks` + flag `--stack-backend` forwardeado. | S |
| 21 | **filesHint por paso** — el builder explora el skeleton por paso (reads exploratorios = tokens). El planner indica `files: [...]` por step y el prompt del builder los lista como "archivos que toca este paso" — sin reads de descubrimiento. | XS |
| 22 | **Plan fijo para extend con contrato claro** — si `frontApiScan` devuelve endpoints CRUD estándar, un plan fijo (backend→integración→tests) salta la sesión del planner entera. | S |
| 31 | **Shapes en frontApiScan** — además de endpoints, detectar los campos que el front consume (`res.salesByRegion`) para que el backend extienda con el DTO exacto. | S-M |
| 30 | **Seed por stack + DB levantable en E2E** — `npm run seed` por stack (datos reales, no mock) + smoke/verify que levanta `docker compose up -d db` o driver embebido (sqljs) si no hay docker. | M |
| 29 | **Cap de rondas review↔fix + re-review scoped** — el loop encontraba issues NUEVOS por ronda hasta reventar `GraphRecursionError: 25` (crash uncaught). Re-review verifica solo lo reportado; ronda 2+ → `pendingIssues` en status.json; catch del error → fail limpio. | M |
| 28 | **Catch `GraphRecursionError` → fail node** — el error mataba el proceso sin pasar por `fail`. Ahora el stream lo atrapa y el run queda `failed` con mensaje claro. | XS |
| 27 | **Whitelist de fuentes de imagen configurable** — los dominios permisivos estaban hardcodeados en `AGENTS.ui.md`. `IMAGE_SOURCES` en `src/tools/image-policy.js` (domain+label+license) renderizado como `{{imageSources}}` por `writeAgentsMd` — agregar una fuente = una línea. | XS |
| 26 | **Placeholder.svg propio** — si ninguna imagen libre aplica (o el usuario pide una que incumple copy), el skeleton trae `public/images/placeholder.svg` (dashed "Seleccionar imagen" — asset propio, cero licencia, el usuario lo reemplaza) — mejor que el bloque con ícono: es un `<img>` real que preserva el layout. | XS |
| 25 | **Imágenes con licencia comercial + descargadas** — apps vendibles: el agente solo usa fuentes de licencia permisiva (Unsplash/Pexels/Pixabay), las **descarga a `public/images/`** (sin hotlink: no hay request de terceros en runtime ni rot) y registra fuente+licencia en `LICENSES.txt`. Regla en `AGENTS.ui.md` generado. | XS |
| 24 | **GitHub opcional — disable + anti-hang** — sin `GITHUB_TOKEN` los toggles github/ghpages/publish aparecían habilitados y fallaban después (503) o peor, un remote SSH con passphrase colgaba el job esperando stdin. `/api/options` expone `github`; la UI deshabilita los controles con hint; `GIT_TERMINAL_PROMPT=0` en los wrappers `git()` convierte el hang en fail legible. El mecanismo para apuntar a otro GitHub (empresa vs personal) ya existía — el token decide la cuenta. | XS |
| 23 | **Plan-repair scoped** — `planRepair` manda `JSON.stringify(plan)` completo; hint del/los pasos que reporta el validador → el agente corrige focalizado sin releer el plan entero. | XS |
| 20 | **Attach front: stack seleccionable (vite-react/nextjs)** — el flujo backend→frontend hardcodeaba `vite-react` en `createDesign`/`attachPlanUpdate`/`saveDesignAttach`. Ahora `POST /api/design` acepta `stackFrontend` (validado `kind==='frontend'`), el diseño copia el skeleton del stack (app-skeleton/app-skeleton-next), `plan.stacks.frontend` persiste el elegido y la UI tiene select en el attach. El `apiContextBlock` ya inyectaba los endpoints reales del back — queda intacto. | S |
| 19 | **Engine activo > plan.agent en resume** — `resolveEngineId` tenía `plan.agent` por encima de `settings.json` → un proyecto creado con opencode seguía en opencode tras cambiar el motor (imposible desbloquear un run sin tokens). Nueva precedencia: flag > settings(≠auto) > env > plan > auto — el engine activo siempre gana, plan.agent es fallback histórico. | XS |
| 32 | **Alembic en el stack fastapi** — las apps python salían con `create_all` (no migra schemas existentes) y cada agente improvisaba migraciones ad-hoc (fleet-pulse las agregó a mano). El `fastapi-skeleton` ahora trae `alembic.ini` + `alembic/` (env.py: engine de `init_db` → `DATABASE_URL` → ini), `init_db()` corre `upgrade head` al boot (sin revisiones → `create_all`; DB legacy → `create_all` + `stamp head`), requirement `alembic` en `validatePlan` exige el paso que genera la baseline autogenerada, y `@ALEMBIC@` en los Dockerfile python copia las migraciones solo si hay `alembic.ini` (mongo comparte template sin tocarlo). **mergeado PR #146** | S |
| 33 | **Attach front a backend python + entrada desde el detalle** — `saveDesignAttach`/`attachFrontendFiles` asumían `package.json` del backend → ENOENT en fastapi (no lo tiene). Ahora sin pkg el del front pasa entero y el rollback es condicional. `ProjectDetail` gana **Agregar frontend** para `scope === 'backend'` → `#/design?attach=<slug>` que preselecciona el backend en el diseñador. **mergeado PR #147** | XS |
| 34 | **Artefactos de save workspace + chip DB externa real** — los proyectos guardados desde las pestañas Backend/Diseño salían sin `status.json`/`timings`/`README` (chips `unknown`, sin ⏱ ni README). `saveBackend` ahora escribe los 3 (plan.timings + status done + writeReadme del finalizer); `saveDesignAttach` refresca status+README al pasar a fullstack y `attachPlanUpdate` completa `plan.timings` en planes legacy. `externalDb` lee el `.env` real (DATABASE_URL/DB_TYPE/MONGO_URI) con fallback a `.env.example` — el example de fastapi no discrimina la DB elegida. writeAgentsMd deja de tragar errores en silencio (console.warn). **mergeado PR #148** | S |
| 35 | **Saves workspace con git + Dockerfile** — los proyectos guardados desde las pestañas Backend/Diseño nacían sin `.git` (sin historia hasta publish) y sin Dockerfile determinístico. `initGitRepo` (common.js) hace init+initial commit idempotente en los 3 saves; `writeDockerFiles` genera Dockerfile por stack si el agente no dejó uno propio (respeta custom). Warn-only ambos. | XS |


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
