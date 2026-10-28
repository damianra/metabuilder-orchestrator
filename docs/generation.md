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
`skeletonDesc`/`agentsStack` (texto para planes y AGENTS.md de la app),
`pagesBaseEnv` (env var para re-build con basePath en Pages; solo
stacks que lo necesitan), `verify` (comandos de finalVerify),
`requirements` (reglas declarativas de validatePlan con `error` +
`prompt` equivalente) y fragmentos `readme`. `resolveStacks(scope,
overrides)` devuelve `{ frontend, backend }`; `planRequirements` los
mergea deduplicando; `finalCheckCommands` arma la batería de verify;
`stackRuleBullets(scope)` genera las reglas que los prompts
`planner.md`/`plan-repair.md` inyectan via `{{stackRules}}` — el
prompt nunca diverge del validador porque leen la misma fuente.
Agregar un stack = nuevo archivo + entrada en el `Map` de `index.js`.

**Selección**: flags `--stack-frontend <id>` / `--stack-backend <id>`
(o pregunta interactiva) → `state.stackFrontend/stackBackend` →
`plan.stacks` (persistido por planner; resume lo restaura igual que
`plan.arch` — ídem `plan.deploy` con `--github`/`--ghpages`: un resume
sin flags de deploy reusa lo que el run original eligió; un
`--github`/`--no-push` explícito lo overridea). `stacksFor(state)` resuelve el stack efectivo en cada
nodo: plan.stacks > flags > defaults. Frontends: `vite-react`
(default), `nextjs`. Backend: `express-sqlite`.

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
si fullstack — mergea deps/scripts). Si el vertical tiene
`src/verticals/<v>/api/` (schema.sql, seed-data.js, routes/) se copia
encima de `server/`. También aplica a `appType: 'custom'` con backend.
Secretos: `.env` (gitignored) leído via `dotenv/config` en
`server/index.js`; `.env.example` commiteado declara las variables.
`app.js` además sirve `<proyecto>/dist/` u `<proyecto>/out/` estático +
SPA fallback GET cuando `index.html` existe en alguno (deploy
single-server y Docker).

Los 3 skeletons incluyen `.github/workflows/ci.yml` (npm ci + `npm audit
--audit-level=critical` + npm test) — la app generada nace con CI de
seguridad propia si se pushea a GitHub.

## Dockerfile por app

Preflight escribe `Dockerfile` + `.dockerignore` en cada app generada
(`src/tools/docker.js` + templates en `src/templates/docker/`):
variante `backend` (node slim, solo `server/`), `fullstack` (build
del frontend → `dist|out/` servido por el mismo Express), `frontend`
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
Tailwind (`nextjs`, static export). Backend: Express/SQLite. Testing:
Vitest / Playwright (e2e solo si hay frontend). Ver
`src/templates/AGENTS.md` para las 5 reglas de UI que el código
generado debe cumplir y que Playwright verifica.
