# MetaBuilder Orchestrator — guía para agentes

Orquestador multi-agente (Node.js ESM + LangGraph) que genera aplicaciones
básicas (landings, pedidos, blogs) delegando la escritura de código a
**Devin CLI via ACP**. Las apps generadas van a `generated-apps/<slug>/`
(gitignored, cada una con su propio repo git).

## Comandos

```bash
npm install
npm start -- --idea "..." --scope fullstack|frontend|backend \
            --app-type landing|orders|blog|custom [--name slug] \
            [--arch flat|mvc|layers|feature] \
            [--stack-frontend vite-react|nextjs] \
            [--stack-backend express-sqlite] \
            [--github] [--no-push] [--keep-going] [-y|--yes]

# Reanudar un run interrumpido desde su plan.json (ruta o slug):
npm start -- --resume generated-apps/<slug> [--github] [--no-push] [-y]

# Cola batch: encolar ideas y procesarlas en serie
npm run queue -- add --idea "..." [-y]   # encola (args = los de npm start)
npm run queue -- list|clear              # estado / limpieza
npm run queue -- cancel <id>             # pending→cancelled; running→flag y el worker mata el árbol
npm run worker                           # procesa jobs/ en orden (una pasada)
npm run queue -- watch                   # idem en loop + heartbeat jobs/.worker
                                         # + stdout/stderr de cada job → jobs/<id>.log
                                         # (es el modo que levanta npm run dashboard)

# Dashboard (API + UI + worker): API en :4100, UI Vite en :4173 con proxy /api
npm run dashboard                        # levanta los 3 (Ctrl+C mata los 3)
npm run dashboard:api                    # solo la API (DASHBOARD_PORT/HOST)
npm --prefix dashboard run dev           # solo la UI
```

Verificación rápida de tools sin tocar el grafo:

```bash
npm test   # suite Vitest del orquestador (tests/)
node -e "import('./src/tools/devin.js').then(m=>m.checkDevinAuth().then(console.log))"
node -e "import('./src/tools/shell.js').then(m=>m.run('echo ok',{cwd:'/tmp'}).then(console.log))"
```

## Arquitectura

`src/orchestrator/graph.js` (LangGraph `StateGraph`):

```
preflight → planner → validate ─┬─→ confirm → builder → verify ─┬─→ builder (siguiente paso)
                                │                               ├─→ finalVerify → review ─┬─→ finalize → END
                                └─→ repairPlan                  └─→ fixer → verify        └─→ fixer

Fail terminal: fallos de transporte/timeout del planner y reintentos
agotados van al nodo `fail` (status: failed), no a repairPlan.

`review` es el sub-agente QA (prompts/reviewer.md): sesión Devin que
inspecciona la app contra AGENTS.md + idea. Responde `RESULT: APPROVED`
(→ finalize) o `RESULT: ISSUES` (→ fixer corrige, consume finalRetries,
vuelve a finalVerify). El repo remoto se crea recién en finalize: evita
repos vacíos si el pipeline falla antes.

## Verticales (skills de generación)

`src/verticals/<nombre>/index.js` exporta `{ name, buildPlan }`. Cada
vertical es un plan determinístico — **el planner NO llama a Devin** para
verticales conocidos, solo para `appType: 'custom'`. Agregar un vertical =
nueva carpeta + registro en `src/verticals/index.js`. Las descripciones de
pasos deben contener las keywords que espera `validator.js` (vite,
playwright, vitest, express, sqlite, "reglas de UI").

- `landing`: frontend-only, página informativa (hero/features/menú/
  contacto/footer). Contenido no provisto → lorem ipsum + placeholders.
- `orders`: pedidos para casas de comida; soporta `fullstack`, `frontend`
  (datos mock) y `backend`. Con backend usa el overlay
  `src/verticals/orders/api/` (schema business/categories/products/
  orders/order_items + routes) sobre el api-skeleton; el paso backend
  es generativo-lite: Devin solo personaliza seed-data.js y endpoints
  extra de la idea.
- `blog`: posts con categorías, tags (N:M) y comentarios moderados;
  soporta los 3 scopes. Overlay `src/verticals/blog/api/`: routes
  posts (`?page&limit&q&category&tag` + `/:slug`), categories, tags y
  comments (POST → `pending`, GET solo aprobados). Mismo paso backend
  generativo-lite.

## Patrones de arquitectura de backend

`src/arch/` declara cada patrón como datos (`flat`, `mvc`, `layers`,
`feature` + `index.js` con `resolveArch`/`applyArch`/`archRuleBullet`).
Flag `--arch <id>` (o pregunta interactiva cuando el scope tiene
backend); `state.arch` → `plan.arch` persiste (resume lo restaura).
`applyArch(plan, arch)` garantiza que cada paso `backend` declare su
patrón: respeta descripciones que ya dicen "arquitectura &lt;id&gt;" y
appenda el bloque canónico a las que no — funciona igual para planes
de verticales y planes escritos por Devin (custom). El validator exige
la mención cuando `plan.arch` está declarado. Invariante:
`server/routes/<name>.js` siempre existe como punto de montaje — lo
que cambia es cuánta lógica vive ahí (flat = todo; mvc/layers/feature
= routes finos que delegan a controllers/models/services/modules).
Preflight appenda `agentsRules` del patrón al AGENTS.md de la app
generada — es el contrato que builder/fixer/reviewer leen.

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
`plan.arch`). `stacksFor(state)` resuelve el stack efectivo en cada
nodo: plan.stacks > flags > defaults. Frontends: `vite-react`
(default), `nextjs`. Backend: `express-sqlite`.

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
vacía), `POST /api/uploads` → `/uploads/<file>`. `preflight` lo copia
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

## API del dashboard (`src/dashboard/server.js`)

Express local (127.0.0.1:4100, `DASHBOARD_PORT`/`DASHBOARD_HOST`) — capa
fina sobre la infra existente:

- `GET /api/projects` — resumen por app en `generated-apps/` (plan.json +
  status.json → status, pasos done/total, arch, hasDockerfile).
- `GET /api/projects/:slug` — detalle: pasos, reporte del último run
  (buildReport en vivo), repoUrl (ssh→https), docker-build.json,
  plan.stacks, `scripts` del package.json de la app y test-run.json.
- `GET /api/projects/:slug/test-log` — tail del `test-run.log` de la
  app + el estado del último test run (mismo formato que el log de job).
- `GET /api/runtime` — `{engine: 'docker'|'podman'|null}` (probe
  `docker info` → `podman info`; positivo cacheado permanente, `null`
  re-probea pasados 30s — el daemon puede aparecer después). El mismo
  binario sirve para todas las acciones de containers (CLI-compatible).
- `GET /api/projects/:slug/container-log?tail=N` — `<engine> logs
  --tail` del container `<slug>` si corre (`docker ps` filtrado por
  nombre es la fuente de verdad — no hay estado persistido);
  `running:false` si no hay engine o no corre. El detalle también
  expone `runtime.image` (`<engine> image inspect <slug>:local`) — la
  UI habilita "Crear contenedor" por imagen presente, no por
  docker-build.json (cubre builds por podman o CLI manual).
- `GET /api/jobs` — `{ jobs, worker }`: cada job enriquecido con
  `projectSlug` (derivado de `--name`/`--resume`/slug de la idea) y
  `progress` (node/step/totalSteps del `status.json` de la app);
  `worker` = liveness leído del heartbeat `jobs/.worker`.
- `GET /api/jobs/:id/log?tail=N` — tail (default 200 líneas) del log que
  el worker captura en `jobs/<id>.log` (stdout+stderr del `npm start` del
  job — incluye el feed del agente: `onActivity` (tool calls) y `onText`
  (texto del agente) de `runDevinPrompt` caen a stderr via `activity`/
  `textFeed` de agents/common.js). `GET /api/projects/:slug/log` — idem
  resolviendo el job más reciente cuyo `projectSlug` coincide con el slug.
- `POST /api/runs` — encola una generación: whitelist de campos
  (idea/scope/appType/name/arch/phone + flags github/ghpages/
  verifyDocker) → args del CLI + `--yes` siempre (un job bajo el worker
  hereda el TTY y los prompts de deploy lo colgarían — por eso `--yes`
  también salta las preguntas github/ghpages en collectArgs).
- `POST /api/projects/:slug/actions` — `resume` (encola
  `--resume <slug> --yes`), `dockerize` (re-escribe Dockerfile según
  filesystem + `<engine> build` async si hay engine (docker o podman)
  → estado en docker-build.json, log en docker-build.log; sin engine →
  skipped),
  `test` (corre `npm test` [+ `npm run test:e2e` si `e2e:true`] async →
  test-run.json/test-run.log en la app; 400 si faltan los scripts, 409
  si hay un run en curso **con pid vivo** — un `running` con pid muerto
  es stale (dashboard caído a mitad) y no bloquea el relanzamiento),
  `open-repo` (devuelve la URL https del
  remote para que la UI la abra), `run-container` (`<engine> run -d
  --name <slug> -p <host>:<container>` — containerPort 4000 si hay
  backend, 80 si es frontend-only/nginx; `port` opcional para el host,
  default sugerido por variante; 503 sin engine, 400 si no existe la
  imagen `<slug>:local`, rm -f previo para reemplazo idempotente) y
  `stop-container` (`<engine> rm -f <slug>`).
- `GET /api/options` — scopes/verticales/archs/stacks leídos de los
  registries; la UI alimenta sus pickers de acá (nada hardcodeado).
- `POST /api/jobs/:id/cancel` — `cancelJob(id)` de queue.js: pending →
  `cancelled` (el worker solo consume pending → nunca arranca); running
  → `cancelRequested` en el JSON y el watcher de `runJob` (500ms) hace
  `kill(-pid)` al process group del child (spawn `detached`), con
  SIGKILL de escalación a los 4s → el close lo marca `cancelled`.
  El pid del child queda persistido en el job mientras corre.
- `WS /api/projects/:slug/terminal` (`src/dashboard/terminal.js`,
  `attachTerminal(server)` colgado en `main()`): spawnea `devin` TUI
  via `node-pty` con cwd en la app. La sesión adquiere un slot de
  `acquireDevinSlot` (espera si hay generación en curso — el cliente
  ve "esperando slot"). Protocolo JSON: in `in`/`resize`/`close`, out
  `out`/`status`/`exit`/`error`. Una sesión por slug — clientes extra
  se adjuntan al mismo pty (mirror + replay de scrollback ~200KB); se
  mata con `close` explícito, exit del pty, o 5 min sin clientes
  (IDLE_KILL_MS). Guardas: slug regex + dir con plan.json bajo
  appsDir, Origin solo localhost (anti-CSWSH), upgrade bajo /api/ que
  no matchea se destruye (si no, el request queda colgado). `node-pty`
  se importa lazy — si el nativo falta, el error va al cliente y la
  API HTTP sigue andando.

La UI vive en `dashboard/` (subpackage propio con su package.json —
Vite+React+Tailwind+Vitest, mismo stack que el app-skeleton). Hash
routing (`#/` lista, `#/p/<slug>` detalle), polling 4-5s. `dev.js`
lanza API+Vite+worker (`queue.js watch`) en un proceso — los jobs
encolados desde la UI se procesan solos; la UI es un consumidor más de
la API — no conoce paths del FS ni los registries directamente.

## Dockerfile por app

Preflight escribe `Dockerfile` + `.dockerignore` en cada app generada
(`src/tools/docker.js` + templates en `src/templates/docker/`):
variante `backend` (node slim, solo `server/`), `fullstack` (build
del frontend → `dist|`out/` servido por el mismo Express), `frontend`
(build → nginx:alpine + `nginx.conf` con SPA fallback). El dir de
salida viene de `stack.buildDir` (placeholder `@OUT_DIR@` en los
templates). En `--resume` la variante y el outDir se detectan por el
filesystem (`vite.config.js`/`next.config.*`/`server/`). Los `FROM`
usan nombres fully-qualified (`docker.io/library/...`) — podman sin
unqualified-search registries rechaza short-names (docker los
resuelve igual, no cambia nada).
`--verify-docker` corre `docker build` en `finalVerify` solo si hay
daemon **docker** (ausente → omite sin fallar; es docker-only — en
hosts con solo podman se omite siempre).

`npm install` corre **lazy en background** (`src/tools/install.js`:
`startInstall`/`awaitInstall`/`isInstalling`, registry por projectDir) —
overlap con planner + confirmación humana. `builder`, `verifier` y
`finalVerify` lo awaitan antes de tocar node_modules. Si el scope tiene
frontend también se pre-calienta `npx playwright install chromium` en
background (nunca se awaita; el paso e2e lo reintenta si hace falta).

**Semáforo de sesiones Devin** (`src/tools/devin-lock.js`): `runDevinPrompt`
adquiere un slot de `~/.metabuilder/devin-slots/slot-N/` antes del spawn
(mkdir atómico + pid file; slots de procesos muertos se reciclan). Con
`MAX_CONCURRENT_DEVIN_SESSIONS=1` (default) nunca hay más de una sesión
`devin acp` a la vez en toda la máquina, aunque corran varios `npm start`
— se serializan solos. `checkDevinAuth` no consume slot (handshake de ~1s
sin trabajo de agente).

## Confirmación de plan

El nodo `confirm` usa `interrupt()` (LangGraph + `MemorySaver`): el grafo
suspende tras validar, el CLI muestra el plan y espera `[S/n]`; resume via
`Command({ resume })`. Se activa solo si stdin es TTY y no se pasó `--yes`.
Rechazar → `fail` sin ejecutar builds.
```

- Estado: `src/orchestrator/state.js` (`Annotation.Root`).
- Nodos: `src/agents/*.js` (un archivo por nodo). Helpers compartidos
  (log, readPlan/writePlan, loadPrompt): `src/agents/common.js`.
- **LangGraph prohíbe que un nodo se llame igual que un canal de estado.**
  Por eso el nodo se llama `planner` (el canal `plan` guarda el plan.json).
- `verifying` en el estado distingue verificación por paso (`'step'`) de la
  final (`'final'`) — `fix` vuelve a `verify` o a `finalVerify` según eso.
- Todo fallo terminal va al nodo `fail` (setea `status: 'failed'`), nunca
  directo a END sin marcar estado.
- Tools: `src/tools/` (`devin.js` cliente ACP, `shell.js` execa, `slug.js`,
  `install.js` npm install lazy, `github.js` REST).
- Prompts versionables: `src/prompts/*.md`.
- `src/templates/AGENTS.md` se **copia a cada app generada** con las reglas
  de UI obligatorias — no confundir con este archivo (raíz), que documenta
  el orquestador.
- `runs/<runId>/` guarda logs JSON-RPC de cada sesión ACP.
  `npm run report -- <runId|slug>` los resume en `report.md` (pasos,
  intentos, duración por sesión); sin args lista runs recientes.

## ⚠️ Integración con Devin CLI — crítico

**No usar `devin -p` / `--print`.** Ese modo exige `session_token` de
cuenta Devin (`app.devin.ai`) que las cuentas Windsurf no producen:
falla con "Not logged in" aunque `credentials.toml` exista y sea válido.

La vía soportada es **`devin acp`** (JSON-RPC sobre stdio), igual que
Devin Desktop. Secuencia (`src/tools/devin.js`):

1. `initialize` (protocolVersion 1, `clientCapabilities: {}`)
2. `authenticate` `{ methodId: "windsurf-api-key", _meta: { api_key, api_server_url } }`
   — leídos de `~/.local/share/devin/credentials.toml`
3. `session/new` `{ cwd, mcpServers: [] }`
4. `session/set_config_option` `mode: "bypass"` (auto-aprueba todo) y
   `model: "swe-2-high"`
5. `session/prompt` con `{ prompt: [{ type: "text", text }] }`
6. Respuesta = concatenar `session/update` con
   `sessionUpdate === "agent_message_chunk"`; fin = resultado con `stopReason`.

Notas ACP:
- `session/request_permission` puede llegar aun en bypass → el cliente
  auto-aprueba la primera opción (red de seguridad).
- **NO anunciar `fs`/`terminal` capabilities.** Si el cliente declara
  `fs.readTextFile/writeTextFile`, el agente delega cada lectura/escritura
  de archivo al cliente via `fs/read_text_file`/`fs/write_text_file` y se
  queda colgado si no respondemos (síntoma: el agente "piensa" 15 min,
  el tool_call dice "Wrote plan.json" pero el archivo nunca aparece).
  Con capabilities vacías usa sus tools nativos (`local_*`) que escriben
  directo en `cwd`. El cliente responde error `-32601` a cualquier
  request no manejada como red de seguridad.
- El prompt del planner debe exigir escritura inmediata con razonamiento
  mínimo — prompts abiertos provocan que el agente explore/piense hasta
  agotar el timeout sin escribir nada.
- **Nunca escribir al log stream tras `end()`**: el proceso hijo puede
  seguir emitiendo stderr/stdout después de `close()` →
  `ERR_STREAM_WRITE_AFTER_END` mata el orquestador (crash sin catch).
  `AcpClient` usa `#writeLog` guardado + `log.on('error', () => {})` —
  mantener ese patrón.
- Pasos `type: 'infra'` con `package.json` ya presente NO llaman a Devin:
  el skeleton lo resolvió; `verify` valida igual.
- Cada paso abre una sesión ACP nueva (`session/new`), pero el proceso
  `devin acp` se **reusa entre pasos del mismo run**: pool a nivel módulo
  en `tools/devin.js` (`warmClient`) — initialize+authenticate una sola
  vez, `setLog` rota el run log por paso. Si el proceso muere (crash o
  kill por timeout) se descarta y el próximo paso respawnea solo. La
  memoria entre pasos es el filesystem + `plan.json` + el AGENTS.md
  copiado. El semáforo sigue limitando sesiones activas, no procesos
  idle — un proceso tibio sin sesión no bloquea a otros runs.
- `devin auth status` y `devin models list` reportan "Not logged in" con
  credenciales Windsurf — es un chequeo de session_token, **no usar como
  probe**. El probe real es `checkDevinAuth()` (initialize+authenticate).

## plan.json (checkpoint dentro de cada app generada)

```json
{
  "projectName": "task-app",
  "scope": "fullstack|frontend|backend",
  "appType": "landing|orders|blog|custom",
  "idea": "...",   // restaurada por --resume (planner la persiste al crear el plan)
  "arch": "flat",  // patrón backend (--arch); resume lo restaura
  "stacks": { "frontend": "vite-react", "backend": "express-sqlite" }, // idem
  "validated": false,
  "steps": [
    { "id": 1, "description": "...", "type": "frontend|backend|test|e2e|infra",
      "verify": "npm run build", "status": "pending", "attempts": 0 }
  ]
}
```

`verify` es un comando ejecutable en el dir del proyecto — el nodo
`verifier` lo corre con `tools/shell.run` (nunca lanza; `{ok, stderr,
timedOut}`).

## Flujo de trabajo Git (obligatorio en ESTE repo)

Aplica a cualquier agente/persona que modifique el orquestador.
**Nunca commitear directo a `main`.**

1. **Branch por implementación**: `feat/<slug>`, `fix/<slug>`,
   `docs/<slug>`, `refactor/<slug>`, `test/<slug>`, `chore/<slug>`
   (ej. `fix/state-reducer-null`, `feat/api-skeleton`).
2. **Commits semánticos** (Conventional Commits): `feat:`, `fix:`,
   `docs:`, `refactor:`, `test:`, `chore:` + descripción corta.
3. **Push de la rama** → crear PR a `main` vía REST (no hay `gh` CLI):
   `createPullRequest(token, 'damianra', 'metabuilder-orchestrator',
   { head, title, body })` de `src/tools/github.js` con `GITHUB_TOKEN`.
4. **CI corre `npm test` en cada PR** (`.github/workflows/test.yml`,
   Node 22, sin secrets) — compuerta determinística automática.

5. **Validación funcional antes de merge — la hace un sub-agente**:
   `npm run validate:pr -- <N>` valida un PR puntual; `npm run
   validate:pr` sin args valida **todos los PRs abiertos pendientes**
   (auto-descubrimiento); `--watch [min]` hace polling continuo
   (default 5 min). En todos los casos crea un worktree temporal del
   head, corre una sesión Devin (`prompts/pr-validator.md`) que revisa
   el diff + ejecuta la validación (`npm test`, `node --check`, smokes
   dirigidos) y comenta el veredicto en el PR — embebido con
   `<!-- validate-pr head:<sha7> -->`, así un push nuevo vuelve a
   marcar el PR como pendiente. El `GITHUB_TOKEN` nunca llega al
   agente — solo lo usa el script para leer el PR y comentar.
   Solo se mergea con `✅ APROBADO PARA MERGE`.

Las **apps generadas** (`generated-apps/<slug>/`) NO siguen este flujo:
pushean `main` directo — su validación funcional ya la hace el
sub-agente `review` + `finalVerify` antes del push.

## Convenciones

- ESM (`"type": "module"`), Node >= 22, imports con extensión `.js`.
- `execa` siempre con `reject: false` en tools — los nodos deciden.
- Reintentos: paso ≤ `MAX_STEP_RETRIES` (3), plan ≤ `MAX_PLAN_RETRIES` (2).
- Nunca commitear `generated-apps/`, `runs/`, `.env`, `*.sqlite`.
- **Docs al día en el mismo PR**: todo cambio de comportamiento, flag,
  comando, env var o instrucción nueva para el usuario/agente debe
  actualizar `README.md`, este `AGENTS.md` y `ROADMAP.md` (si aplica).
  Un PR de código sin sus docs está incompleto.

## Stack apps generadas

Frontend: React+Vite+Tailwind (`vite-react`, default) o Next.js+React+
Tailwind (`nextjs`, static export). Backend: Express/SQLite. Testing:
Vitest / Playwright (e2e solo si hay frontend). Ver
`src/templates/AGENTS.md` para las 5 reglas de UI que el código
generado debe cumplir y que Playwright verifica.

## Finalización (finalizer.js)

`finalVerify` corre la batería según scope: `npm run build` +
`npx vitest run` + `npm run test:e2e` (solo si hay frontend; backend
solo vitest). Falla → loop `fix` (finalRetries) → `fail`.

`finalize`:
1. `git init -b main` + config user + `add -A` + commit en la app.
2. `--no-push` → termina ahí.
3. `GITHUB_REPO_URL` → remote + push (repo pre-creado, SSH).
4. `--github` + `GITHUB_TOKEN` (PAT scope `repo` en .env) →
   `POST /user/repos` crea el repo, push con `http.extraHeader`
   (el token NO queda en el remote ni en logs — `sanitize()`),
   `<buildDir>/` del stack → rama `gh-pages` (repo git propio dentro
   del dir) + `POST /repos/{o}/{r}/pages` →
   `https://<user>.github.io/<repo>/`. Solo scopes con frontend.
   Vite usa `base: './'`; stacks con `pagesBaseEnv` (Next) se
   re-buildean con `PAGES_BASE=/<repo>` antes de publicar.
5. Sin URL ni --github → commit local + aviso.

## Troubleshooting conocido

- **Playwright browsers**: en la app generada `npx playwright install
  chromium` (sin `--with-deps`, requiere sudo). Si faltan libs del SO:
  `sudo npx playwright install-deps chromium`.
- **Timeout de paso**: `DEVIN_TIMEOUT_MS` (default 15 min).
- **Chromium de Playwright**: browsers en `~/.cache/ms-playwright`
  (compartido entre apps) — una sola descarga. Si falta:
  `npx playwright install chromium` dentro de la app generada.
- **Push HTTPS a GitHub**: `http.extraHeader` con `Bearer` NO funciona —
  usar `git -c http.https://github.com.extraHeader="Authorization: Basic
  base64(x-access-token:$GITHUB_TOKEN)"` (ver `ghAuthArgs` en
  `agents/finalizer.js`). El token nunca entra al remote ni a los logs.
- **Pages**: pushear la rama `gh-pages` suele auto-habilitar Pages; el
  POST a `/repos/{o}/{r}/pages` puede devolver 500 transitorio o 409
  "already enabled" — `enablePagesWithRetry` reintenta los 5xx (3×4s),
  un 409 o fallo persistente cae al GET de confirmación.
- **Commit en re-runs**: si la app ya tiene todo commiteado, el finalize
  salta el commit vía `git diff --cached --quiet`.
