# Generación — verticales, stacks, arquitectura, skeletons

## Verticales (skills de generación)

`src/verticals/<nombre>/index.js` exporta `{ name, buildPlan }`. Cada
vertical es un plan determinístico — **el planner NO llama a Devin** para
verticales conocidos, solo para `appType: 'custom'`. Agregar un vertical =
nueva carpeta + registro en `src/verticals/index.js`. Las descripciones de
pasos deben contener las keywords que espera `validator.js` (vite,
playwright, vitest, express, sqlite, "reglas de UI" y —con frontend—
"privacidad"/"consentimiento"). Los pasos `frontend`
appendan `legalBlock` (`src/verticals/legal.js`): página `/privacidad`,
checkbox de consentimiento en formularios con datos personales,
prohibición de trackers sin banner, sin `dangerouslySetInnerHTML` con
datos de usuario — reforzado por las "Reglas de privacidad y seguridad"
del `src/templates/AGENTS.md` y la sección legal del README generado.

- `landing`: frontend-only, página informativa (hero/features/menú/
  footer; contacto con formulario + botón flotante WhatsApp SOLO si se
  provisto `phone` — sin número, el plan no los incluye).
  Contenido no provisto → lorem ipsum + placeholders.
- `orders`: pedidos para casas de comida; soporta `fullstack`, `frontend`
  (datos mock) y `backend`. Envío por WhatsApp solo si hay `phone` — sin
  número el pedido confirma via `POST /api/orders` (con API) o con
  confirmación local. Con backend usa el overlay
  `src/verticals/orders/api/` (schema business/categories/products/
  orders/order_items + routes) sobre el api-skeleton; el paso backend
  es generativo-lite: Devin solo personaliza seed-data.js y endpoints
  extra de la idea.
- `blog`: posts con categorías, tags (N:M) y comentarios moderados;
  soporta los 3 scopes. Overlay `src/verticals/blog/api/`: routes
  posts (`?page&limit&q&category&tag` + `/:slug`), categories, tags y
  comments (POST → `pending`, GET solo aprobados). Mismo paso backend
  generativo-lite.

## Registry de stacks

`src/stacks/` declara cada stack como datos (un archivo por stack +
`index.js` con el registro): `id`, `kind` (frontend|backend), `label`,
`skeletonDir`, `buildDir` (dir de salida del build: `dist`/`out`),
`skeletonDesc`/`agentsStack`/`agentsDb` (texto para planes y AGENTS.md de la app),
`pagesBaseEnv` (env var para re-build con basePath en Pages; solo
stacks que lo necesitan), `requirements` (reglas declarativas de
validatePlan con `error` + `prompt` equivalente) y fragmentos `readme`.
`resolveStacks(scope, overrides)` devuelve `{ frontend, backend }`;
`planRequirements` los mergea deduplicando; `finalCheckCommands` arma
la batería de verify; `stackRuleBullets(scope)` genera las reglas que
los prompts `planner.md`/`plan-repair.md` inyectan via `{{stackRules}}`
— el prompt nunca diverge del validador porque leen la misma fuente.
Agregar un stack = nuevo archivo + entrada en el `Map` de `index.js`.

**Toolchain** (`toolchain` en cada def) — los comandos del stack que
los nodos y el dashboard ejecutan, para que nada quede acoplado a npm:

- `manifest` — archivo que delata deps a instalar (`package.json`;
  `requirements.txt`/`pyproject.toml` en un stack python).
- `installCmd` — install de deps en background (`install.js`, disparado
  por preflight con `installCommands(dir, stacks)` — corre por manifest
  presente, dedup por comando).
- `buildCmd`/`testCmd`/`e2eCmd` — batería de `finalVerify`
  (`finalCheckCommands`), en ese orden. `testCmd` también alimenta la
  acción `test` del dashboard, el README generado y el `verify`
  sintético de `saveBackend`.
- `devCmd`/`devPort` — "Correr en dev" del dashboard (`devTargets`):
  `npm run dev` :5173/:3000 en front, `npm run api` :4000 en back.
- `agentsNotes` — bullets de la sección "Notas" del AGENTS.md
  generado ({{backendNotes}}) — convenciones del stack para el
  agente que retome la app.
- `dockerfile` — variante `Dockerfile.<variant>` backend-only que
  `writeDockerFiles` copia (`backend` express, `backend-ts` nest).
- `markers` — paths (o RegExp) que delatan el backend dir
  (`hasBackendDir`): `server/` express, `nest-cli.json` nest.

**Detección** (`detect`, `detectPriority` en cada def) — identificación
de stack en un dir existente, usada por `detectStackId`/
`detectBackendStackId`/`detectOutDir`/`detectFrontend`
(`tools/docker.js`) para resume, apps sin `plan.stacks` y workspaces.
Menor `detectPriority` se evalúa primero: nest (10) antes que
express-mongo (30) porque su skeleton trae `mongodb` como dep;
nextjs (10) antes que vite-react (20) si hay ambos configs; mysql (40)
antes que postgres (50) — se desempatan por `DB_DRIVER` en `.env`.
Helpers compartidos en `src/stacks/helpers.js` (`pkgDeps`, `envValue`,
`hasMarker`).

**Framework × DB**: cada def backend declara `framework` (`express`|
`nest`|`fastapi`) y `dbs` cubiertas — `resolveBackendStackId(fw, db)
→ stackId` (combo inválido → null; fastapi+mongo queda fase 2) y
`backendMatrix()` arma la matriz para los pickers. El form Fullstack
y el Backend tab muestran **2 selects** (framework + db filtrada por
compat) y la API resuelve el stackId (`backendFramework`/`backendDb`
en POST /api/runs y POST /api/backend — `stackBackend`/`stackId`
directos siguen aceptándose por back-compat).

**Selección**: flags `--stack-frontend <id>` / `--stack-backend <id>`
(o pregunta interactiva) → `state.stackFrontend/stackBackend` →
`plan.stacks` (persistido por planner; resume lo restaura igual que
`plan.arch` — ídem `plan.deploy` con `--github`/`--ghpages`: un resume
sin flags de deploy reusa lo que el run original eligió; un
`--github`/`--no-push` explícito lo overridea). `stacksFor(state)` resuelve el stack efectivo en cada
nodo: plan.stacks > flags > defaults. Frontends: `vite-react`
(default), `nextjs`. Backend: `express-sqlite` (default),
`express-postgres`, `express-mysql`, `express-mongo`,
`nest-typeorm` (fullstack desde v13 #5 — el código backend vive en `server/` y tsc emite a `dist-server/` para no colisionar con `src/` ni `dist/` de vite; antes era backend-only porque dist/ colisionaba
y necesita `Dockerfile.backend-ts` con build stage tsc; `db.js`→
`server/database.module.ts` con TypeORM por `DB_TYPE`), `fastapi`
(**Python** — primer stack no-Node: toolchain pip/pytest/uvicorn sobre
`requirements.txt`, ver abajo) — los express sql comparten
`api-skeleton-sql` (pool + `q()` con `?`→`$n` normalizado + schema por
driver + `.env.example` con `DB_*`); mongo usa `api-skeleton-mongo`
(`col(name)` del driver nativo + `MONGO_URI`/`MONGO_DB`, schemaless).
Los verticales `orders`/`blog` solo aplican a `express-sqlite` — con
otro stack el app-type queda `custom` (gate en enqueue/CLI/form).

## Patrones de arquitectura de backend

`src/arch/` declara cada patrón como datos (`flat`, `mvc`, `layers`,
`feature` + `index.js` con `resolveArch`/`applyArch`/`archRuleBullet`).
Flag `--arch <id>` (o pregunta interactiva cuando el scope tiene
backend); `state.arch` → `plan.arch` persiste (resume lo restaura).
`applyArch(plan, arch)` garantiza que cada paso `backend` declare su
patrón: respeta descripciones que ya dicen "arquitectura <id>" y
appenda el bloque canónico a las que no — funciona igual para planes
de verticales y planes escritos por Devin (custom). El validator exige
la mención cuando `plan.arch` está declarado. Invariante:
`server/routes/<name>.js` siempre existe como punto de montaje — lo
que cambia es cuánta lógica vive ahí (flat = todo; mvc/layers/feature
= routes finos que delegan a controllers/models/services/modules).
Preflight appenda `agentsRules` del patrón al AGENTS.md de la app
generada — es el contrato que builder/fixer/reviewer leen.

## Registry de cumplimiento

`src/compliance/` declara cada perfil legal/de seguridad como datos
(`privacidad`, `notfound`, `cookies`, `terminos`, `pagos`, `auth`,
`menores`):
`promptBlock` (bloque canónico inyectado en la descripción de un paso),
`requirements` (misma forma que los de stacks — `check`/`type`/`keywords`/
`error` + `prompt` equivalente), `infer` opcional (regex de detección
sobre la idea) y `overlayDir` opcional (`src/compliance/overlays/<id>/`
— archivos que preflight copia al proyecto cuando el perfil está
activo, p.ej. `CookieBanner.jsx`/`AgeGate.jsx` en `src/components/`:
componentes listos para integrar, no prompt-only). `resolveCompliance` arma la lista de perfiles activos:
**base siempre** (`privacidad`+`notfound` cuando el scope tiene
frontend — el usuario no tiene que pedirlos) + inferidos por la idea +
explícitos del flag `--compliance a,b,c` (aditivo — nunca quita la
base; id inválido → exit 2). El scope filtra: `auth` solo si hay
backend; `privacidad`/`notfound`/`cookies`/`terminos`/`menores` solo
si hay frontend.

`applyCompliance(plan, ids)` corre en el planner junto a `applyArch`:
si algún paso del tipo requerido ya cubre las keywords del perfil lo
respeta; si no, appenda el `promptBlock` canónico al paso relevante.
Funciona igual para planes de verticales (donde `legalBlock` ya cubre
`privacidad` — no se duplica) y planes `custom` escritos por Devin.
`plan.compliance` persiste; `complianceFor` resuelve la precedencia
flag > plan > inferencia — el resume restaura como `plan.stacks`. Los
bullets llegan a `planner.md`/`plan-repair.md` merged en `stackRules`:
una sola fuente para validator y prompts. El `reviewer.md` incluye el
check "perfiles declarados en `plan.compliance` implementados". El
dashboard expone `compliance` en `GET /api/options` y lo acepta en
`POST /api/runs`. Agregar un perfil = nuevo archivo + entrada en el
`Map` de `index.js`.

## Skeleton de app

`src/templates/app-skeleton/` es un proyecto Vite+React+Tailwind+Vitest+
Playwright **funcional** que `preflight` copia a la app generada cuando el
vertical tiene frontend (scope ≠ backend) y reemplaza `__APP_NAME__`.
El builder nunca hace scaffolding desde cero.
Nota: `vite.config.js` excluye `e2e/**` de Vitest — sin eso Vitest intenta
correr los specs de Playwright y falla. Además proxea `/api` y `/uploads`
a :4000 (config muerta si el scope no tiene backend).

`src/templates/app-skeleton-next/` es la variante Next.js 15 + React 19
(App Router, `output: 'export'` → `out/`): mismo contrato de scripts
(`build`/`test`/`test:e2e`), `vitest.config.mjs` excluye `e2e/**`, y el
proxy de dev a :4000 vive en los `rewrites` de `next.config.mjs` (solo
`NODE_ENV=development` — el export no los soporta). `basePath:
process.env.PAGES_BASE` permite el re-build para GitHub Pages.

`src/templates/api-skeleton/` es el equivalente de backend: Express 5 +
better-sqlite3 + multer, auto-mount de `server/routes/<name>.js` en
`/api/<name>`, `schema.sql` + `seed-data.js` (seed solo si la tabla está
vacía), `POST /api/uploads` → `/uploads/<file>` (whitelist por
extensión — SVG fuera, XSS same-origin), request logging propio
(`server/log.js` — línea `método url status ms` por request, así los
logs del container/dev-run muestran tráfico real) y `server/security.js`
(headers nosniff/X-Frame-Options/Referrer-Policy + rate limit in-memory
20/min por IP solo en métodos de escritura + `capString` para campos
libres; error handler: 500s responden genérico). `preflight` lo copia
cuando el scope tiene backend (standalone si scope=backend — el
`package.partial.json` pasa a `package.json`; overlay sobre app-skeleton
si fullstack — mergea deps/scripts). `package.partial.json` y
`gitignore.partial` son **opcionales**: un skeleton no-Node no los trae
y `copyApiSkeleton` igual aplica la copia. Si el vertical tiene
`src/verticals/<v>/api/` (schema.sql, seed-data.js, routes/) se copia
encima de `server/`. También aplica a `appType: 'custom'` con backend.
Secretos: `.env` (gitignored) leído via `dotenv/config` en
`server/index.js`; `.env.example` commiteado declara las variables.
`app.js` además sirve `<proyecto>/dist/` u `<proyecto>/out/` estático +
SPA fallback GET cuando `index.html` existe en alguno (deploy
single-server y Docker).

`src/templates/fastapi-skeleton-mongo/` es la variante MongoDB del
skeleton anterior (stack `fastapi-mongo`, `framework:'fastapi' +
dbs:['mongo']` — última celda de la matriz): ODMantic sobre Motor
(async — `app/db.py` arma `AsyncIOMotorClient`/`AIOEngine` por
`MONGO_URI`/`MONGO_DB`), los `app/models.py` son `odmantic.Model`
(pydantic — van directo como `response_model`, sin `schemas.py`),
routers async (`await engine.find/save/delete`, ids `ObjectId`), y
los tests usan `mongomock-motor` (self-contained — mongomock no
soporta sessions, así que el test reimplementa las writes de
ODMantic directo sobre la collection). Comparte `main.py`
(auto-mount, CORS, SPA fallback, `/api/health`), toolchain python y
`Dockerfile.python`/`fullstack-python` con `fastapi`; `detect` gana
por `odmantic|motor` en requirements (prioridad mayor que `fastapi`
— mismo patrón nest-vs-mongo).

`src/templates/fastapi-skeleton/` es el skeleton del stack no-Node:
FastAPI + SQLAlchemy sobre `app/` — `main.py` con auto-mount de
`app/routers/<name>.py` (exporta `router` → `/api/<name>`, igual que
express), `/api/health`, CORS, request log + security headers + rate
limit por IP en escritura (espejo de `security.js`/`log.js`), `/api/*`
404 JSON, y `dist/` u `out/` estático + SPA fallback si existe el
build del front. `app/db.py` arma engine/session/Base por
`DATABASE_URL` en `.env` (sqlite local default; postgres/mysql por
URL — el driver pip se declara comentado en `requirements.txt`),
`app/models.py` entities, `app/schemas.py` Pydantic, `app/seed.py`
seed idempotente. Tests pytest + TestClient en `tests/`
(`conftest.py` raíz para que `import app` resuelva). No trae
`package.partial.json` — `copyApiSkeleton` lo tolera desde v12 #1.

Los 4 skeletons incluyen `.github/workflows/ci.yml` (node o python
según stack — `npm ci` + audit + test / pip + pip-audit + pytest; el
de fastapi corre el lado npm solo si hay `package.json`) — la app
generada nace con CI de seguridad propia si se pushea a GitHub.

## Prompt pruning por relevancia (v13)

El `AGENTS.md` que recibe cada agente se arma por secciones según el
run real: `AGENTS.ui.md` (reglas UI + guía de diseño) solo con
frontend; `AGENTS.whatsapp.md` solo si `appType === 'orders'` o la
idea menciona WhatsApp — ~30% menos texto inyectado por llamada.

## Contract test por endpoint (v13)

En `finalVerify` (post-pasos, sobre el dominio real) se emite un test
estático por endpoint del `apiSurfaceFor` — `test/api-contract.test.js`
(vitest) o `test_api_contract.py` (pytest): cada ruta debe existir y
seguir registrada. Corre dentro del `npm test`/`pytest` de la app y
viaja con ella — el agente solo escribe tests de dominio.

## Dockerfile por app

Preflight escribe `Dockerfile` + `.dockerignore` en cada app generada
(`src/tools/docker.js` + templates en `src/templates/docker/`):
variante `backend` (node slim, solo `server/`), `backend-ts` (nest,
stage tsc → `dist/`), `python` (fastapi slim, uvicorn :4000),
`fullstack` (build del frontend → `dist|out/` servido por el mismo
Express), `fullstack-python` (build node → `dist|out/` servido por
FastAPI — lo elige `toolchain.dockerfileFullstack`), `frontend`
(build → nginx:alpine + `nginx.conf` con SPA fallback). El dir de
salida viene de `stack.buildDir` (placeholder `@OUT_DIR@` en los
templates). En `--resume` la variante y el outDir se detectan por el
filesystem (`vite.config.js`/`next.config.*`/`server/`). Los `FROM`
usan nombres fully-qualified (`docker.io/library/...`) — podman sin
unqualified-search registries rechaza short-names (docker los
resuelve igual, no cambia nada).
`--verify-docker` corre `docker build` en `finalVerify` con el engine
detectado (docker → podman; ausente → omite sin fallar).

## Stack de las apps generadas

Frontend: React+Vite+Tailwind (`vite-react`, default) o Next.js+React+
Tailwind (`nextjs`, static export). Backend: Express (sqlite/postgres/
mysql/mongo), NestJS+TypeORM o FastAPI+SQLAlchemy (Python). Testing:
Vitest/pytest / Playwright (e2e solo si hay frontend). Ver
`src/templates/AGENTS.md` para las 5 reglas de UI que el código
generado debe cumplir y que Playwright verifica.
