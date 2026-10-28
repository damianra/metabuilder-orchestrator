# Dashboard — API, UI y terminal

Express local (127.0.0.1:4100, `DASHBOARD_PORT`/`DASHBOARD_HOST`) en
`src/dashboard/server.js` — capa fina sobre la infra existente.
**Boundary de seguridad**: la API ejecuta código arbitrario sin auth
(encolar ideas → el agente escribe/corre builds; kill de procesos;
delete de dirs) — el bind loopback ES la frontera. Si `DASHBOARD_HOST`
no es loopback, `main()` loguea un warning explícito al arrancar.

## Endpoints

- `GET /api/projects` — resumen por app en `generated-apps/` (plan.json +
  status.json → status, pasos done/total, arch, hasDockerfile,
  `hasRemote` si el repo tiene remote `origin` configurado).
- `GET /api/projects/:slug` — detalle: pasos, reporte del último run
  (buildReport en vivo), repoUrl (ssh→https), docker-build.json,
  plan.stacks, `scripts` del package.json de la app, test-run.json,
  `devRun` (dev-run.json enriquecido con alive por pid + `stale`),
  `publish` (publish.json: running/done/failed + repoUrl/pagesUrl) y
  `devTargets` (scripts dev/api disponibles → puerto esperado:
  dev→5173 Vite / 3000 Next según `next.config.*`, api→4000).
- `GET /api/projects/:slug/test-log` — tail del `test-run.log` de la
  app + el estado del último test run (mismo formato que el log de job).
- `GET /api/projects/:slug/publish-log` — tail del `publish.log` +
  estado del último publish (`publish.json`). La UI lo pide lazy desde
  el toggle "publish log" del detalle.
- `GET /api/projects/:slug/dev-log` — tail del `dev-run.log` + estado
  del dev run + `urls` parseadas del output (`http://localhost:<port>`)
  — vite/next/api imprimen su puerto real al arrancar, que puede no ser
  el convencional si estaba ocupado.
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
- `GET /api/jobs/:id/log?tail=N` — tail (default 200 líneas, clamp
  `>=1`) del log que
  el worker captura en `jobs/<id>.log` (stdout+stderr del `npm start` del
  job — incluye el feed del agente: `onActivity` (tool calls) y `onText`
  (texto del agente) de `runAgentPrompt` caen a stderr via `activity`/
  `textFeed` de agents/common.js). `GET /api/projects/:slug/log` — idem
  resolviendo el job más reciente cuyo `projectSlug` coincide con el slug.
- `POST /api/runs` — encola una generación: whitelist de campos
  (idea/scope/appType/name/arch/phone/agent/stackFrontend/stackBackend/
  compliance + flags github/ghpages/verifyDocker) → args del CLI + `--yes` siempre (un job bajo el worker
  hereda el TTY y los prompts de deploy lo colgarían — por eso `--yes`
  también salta las preguntas github/ghpages en collectArgs). 400 si no
  hay engine de agente resoluble (setup gate).
- `POST /api/projects/:slug/actions` — `resume` (encola
  `--resume <slug> --yes` — sin flags de deploy: el CLI restaura
  `plan.deploy`, "lo ingresado previamente"; publicar es acción aparte),
  `add-backend` (encola `--extend <slug> --yes` — convierte un
  proyecto frontend en fullstack; acepta `idea`/`arch`/`github`/
  `ghpages`; sin `github` agrega `--no-push`; 409 si ya tiene
  `server/`),
- `GET /api/projects/:slug/api-surface` — escanea según el stack del proyecto (`detectBackendStackId` → `apiSurfaceKindOf`): `server/routes/*.js` (`express-routes`, default) o `src/**/*.controller.ts` (`nest-controllers`)
  (auto-mount `/api/<file>` + `router.<method>('<path>')`) →
  `{endpoints:[{method, path, file}]}`. El detalle lo muestra como
  sección "API" (tabla método+ruta) con "probar" por endpoint GET
  cuando el dev-run corre;
- `GET /api/projects/:slug/probe?path=/api/...` — proxy del "probar":
  fetch server-side a `localhost:<apiPort>` (del dev-run; el skeleton
  no emite CORS, el browser no podría llamarlo directo). Solo paths
  `/api/*` → 400; respeta el puerto real de `devTargets` → `{status,
  body}` (body truncado a 4KB);
  `publish` (async — `publishRepo` de `src/tools/publish.js` en
  background: crea el repo via REST si falta, commitea lo pendiente,
  pushea `main` y — solo con `ghpages:true` y scope con frontend —
  corre el build [con `pagesBaseEnv` si el stack lo exige], pushea
  `<buildDir>/` a `gh-pages` y activa Pages. Estado en `publish.json`
  dentro de la app — running/done/failed + repoUrl/pagesUrl +
  `pagesError` (un deploy a gh-pages fallido NO reporta pagesUrl — el
  push a main pudo salir igual), expuesto
  como `publish` en el detalle; output crudo en `publish.log`
  (git/build/deploy, append por run — `GET publish-log` lo sirve);
  202 al lanzar, 409 si hay uno en curso
  con pid vivo — `running` con pid muerto es stale y no bloquea —, 503
  sin GITHUB_TOKEN; `githubApi` inyectable en tests), `dockerize` (re-escribe Dockerfile según
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
  imagen `<slug>:local`, rm -f previo para reemplazo idempotente),
  `stop-container` (`<engine> rm -f <slug>`), `run-dev` (spawnea
  `npm run dev`/`npm run api` según los scripts de la app — childs
  `detached` con pids en dev-run.json y output compartido en
  dev-run.log; 400 si la app no tiene scripts dev/api, 409 si hay un
  run con pids vivos — `running` con pids muertos es stale y no
  bloquea), `stop-dev` (`kill(-pid)` SIGTERM al process group de cada
  proc → cubre npm + vite/next + descendientes; marca stopped) y
  `delete` (borra `generated-apps/<slug>` recursivo + `<engine> rm -f`
  y `rmi -f <slug>:local` si hay engine + frena el dev run vigente +
  cierra las sesiones de terminal del slug via `attachTerminal().killBySlug`;
  **no exige plan.json** — cubre dirs huérfanos de runs muertos en
  preflight, única acción con `requirePlan:false`; 409 si hay job
  pending/running del slug — el worker escribe dentro del dir, con
  re-check justo antes del rmSync por TOCTOU).
- `GET /api/projects/:slug/repo` — `{repoUrl, pagesUrl}` del remoto
  git: `toWebUrl(remote)` + `pagesUrl` (`<owner>.github.io/<repo>/`)
  derivada solo si existe el branch `gh-pages` en `git ls-remote`.
  Endpoint aparte del detalle porque ls-remote pega en la red — la UI
  lo consulta on-demand al montar, no en cada poll de 5s.
- `GET /api/options` — scopes/verticales/archs/stacks leídos de los
  registries + `engines` (ids del registry de agentes) y `engine` (el
  configurado en settings.json/env, o null → setup gate en la UI).
- `GET /api/engines` — probe por engine: `{id,label,bin,installed,
  auth,detail,docsUrl,installHint,authHint}` + `engine` configurado. `installed`
  via `command -v`; `auth` via `checkEngineAuth` (handshake ACP real)
  — `agentProbe` es inyectable para tests.
- `POST /api/settings` — `{engine}` → persiste en `settings.json`
  (write atómico); 400 si el id no está en el registry. Es lo que
  escribe el setup gate del dashboard.
- `POST /api/jobs/:id/cancel` — `cancelJob(id)` de queue.js: pending →
  `cancelled` (el worker solo consume pending → nunca arranca); running
  → `cancelRequested` en el JSON y el watcher de `runJob` (500ms) hace
  `kill(-pid)` al process group del child (spawn `detached`), con
  SIGKILL de escalación a los 4s → el close lo marca `cancelled`.
- `POST /api/jobs/:id/requeue` — re-encola los args verbatim de un job
  terminado (`addJob` → nuevo id, nuevo `.log`); 409 si sigue
  pending/running (no se duplica), 404 si no existe. La UI expone
  "reintentar" en failed/cancelled (QueuePanel y "Log del run" del
  detalle).
  El pid del child queda persistido en el job mientras corre.
- `POST /api/jobs/clear` — `clearJobs(baseDir)` de queue.js: borra
  `<id>.json` + `<id>.log` de los jobs terminados (done/failed/
  cancelled) → `{ok, removed}`; pending/running nunca se tocan. Es el
  equivalente al `npm run queue -- clear` del CLI (misma función). La
  UI lo expone como "limpiar terminados" en el header de QueuePanel;
  el panel muestra todos los activos + los últimos 5 terminados (si
  hay más, "…y N más").
- `WS /api/projects/:slug/terminal` (`src/dashboard/terminal.js`,
  `attachTerminal(server)` colgado en `main()`): spawnea el TUI del
  engine (`devin` / `opencode`, elegido con `?engine=<id>` o el engine
  configurado en settings.json) via `node-pty` con cwd en la app. La
  sesión adquiere un slot de `acquireDevinSlot` (espera si hay
  generación en curso — el cliente ve "esperando slot"). Protocolo
  JSON: in `in`/`resize`/`close`, out `out`/`status`/`exit`/`error`.
  Una sesión por `slug:engine` (los dos engines conviven) — clientes
  extra se adjuntan al mismo pty (mirror + replay de scrollback ~200KB); se
  mata con `close` explícito, exit del pty, o 5 min sin clientes
  (IDLE_KILL_MS). Guardas: slug regex + dir con plan.json bajo
  appsDir, Origin solo localhost (anti-CSWSH), upgrade bajo /api/ que
  no matchea se destruye (si no, el request queda colgado). `node-pty`
  se importa lazy — si el nativo falta, el error va al cliente y la
  API HTTP sigue andando.

## UI (`dashboard/`)

Subpackage propio con su package.json —
Vite+React+Tailwind+Vitest, mismo stack que el app-skeleton. Hash
routing (`#/` Diseñar app, `#/backend` tab Backend, `#/fullstack` tab
Fullstack, `#/p/<slug>` detalle), polling 4-5s. `dev.js`
lanza API+Vite+worker (`queue.js watch`) en un proceso — los jobs
encolados desde la UI se procesan solos; la UI es un consumidor más de
la API — no conoce paths del FS ni los registries directamente.
La vista principal son tres tabs — "Backend" (`BackendTab.jsx`: chat
con un agente backend-experto sobre `backend-work/` = skeleton del
stack elegido (`createBackend(stackId)` copia `skeletonDir` y lo
persiste en `backend-state.json`; el prompt recibe las convenciones
del stack via `agentsStack`/`agentsDb`), api-surface en vivo +
probar via `/api/backend/probe`, guardar → plan sintético scope
`backend`; picker de stack backend en la pantalla de crear —
compliance la infiere el agente) + cola + proyectos, "Diseñar app"
(`DesignTab.jsx`) y "Fullstack" (`NewAppForm` con
`fixedScope="fullstack"` — front+back en un solo run, la vía rápida).
Los endpoints `/api/backend*` son espejo de `/api/design*`
(status/create/delete/chat-SSE/dev/stop-dev/probe/save) sobre
`src/design/backend-session.js`; el idle-parking usa el mismo
`DESIGN_IDLE_MS`. Diseñar app: chat iterativo con el
agente sobre un workspace Vite (`design-work/`), preview en vivo en
iframe (la URL se lee de `GET /api/design` → `urls`, parseada del
dev-run.log), input de slug para guardar como app real y descartar
con doble confirmación. El chat consume el SSE de
`POST /api/design/chat` con fetch+stream (EventSource no soporta POST)
y renderiza el reply a medida que llegan los `chunk`.
`src/notifications.js` compara el snapshot de jobs entre polls y dispara
`Notification` del browser cuando un job pasa a done/failed/cancelled
(permiso on-demand via el botón campana del header; solo con la pestaña
en background — el primer poll nunca notifica).

## Flujo diseño → fullstack

Las dos pestañas se componen en un solo proyecto (no son dos
proyectos que se mergean):

1. Diseño → `guardar` → `onSaved(slug)` navega a `#/p/<slug>` — el
   detalle del proyecto recién creado.
2. `ProjectDetail` muestra el botón **Agregar backend** solo si
   `project.scope === 'frontend'` → modal (idea del dominio — vacío =
   la infiere de la UI —, arch, github/ghpages) → `POST actions
   {action:'add-backend'}` → job `--extend` (ver docs/pipeline.md).
3. Las propuestas del chat también enrutan acá: `action:'save'` y
   `action:'extend'` enfocan el input de slug (el guardado es el paso
   previo obligatorio — extend opera sobre un proyecto persistido).
4. Post-extend el detalle gana la sección **API** (`api-surface` +
   `probe`) — los endpoints que el agente acaba de construir.

Sin engine configurado, `SetupGate` ocupa la pantalla completa: cards
por engine con estado del probe (`GET /api/engines`), links a docs de
instalación y "re-chequear"; el header muestra chip "motor: <label>"
para cambiarlo en cualquier momento (`POST /api/settings`).

- `GET /api/design` — estado del workspace de diseño (`design-work/` en
  la raíz, fuera de generated-apps): `exists`, historial `messages`.
  `POST /api/design` crea el workspace copiando el app-skeleton
  (409 si ya hay uno); `DELETE /api/design` lo descarta (frena el dev run).
- `POST /api/design/chat` — `{text, agent?}` → SSE `chunk`/`activity`
  por mensaje + `done`/`error`. El historial se repliega en cada prompt
  (la memoria vive en `design-state.json`, gitignored).
- `POST /api/design/dev` — levanta el vite del workspace (misma lógica
  de run-dev) → url para el iframe de preview; `POST /api/design/stop-dev`.
- `POST /api/design/save` — `{slug}` → mueve el workspace a
  `generated-apps/<slug>` con plan.json sintético (sin node_modules ni
  state files) → todas las acciones de proyecto quedan habilitadas.

Idle-parking: `designIdleSweep()` corre en un `setInterval` (60s,
`unref`) en `main()` — frena el vite dev del workspace cuando la
actividad supera `DESIGN_IDLE_MS` (default 15 min). La "actividad" la
toca cada llamada a `designStatus`/`designChat`/`designDev`/
`createDesign`: como DesignTab pollea status cada 3s, el preview solo
se apaga cuando nadie tiene la tab abierta (de ahí que el sweep corra
por timer y no lazy — con la tab cerrada nadie llama a la API, que es
justo el caso a cubrir). `designStatus` además gatea `urls` por
`dev-run.json` vivo: un run `stopped` no reporta URL stale.

Attach a backend (v10): `POST /api/design {for: slug}` crea el
workspace ataado a un proyecto backend (valida: existe, `plan.scope ===
'backend'`, sin `src/`/`index.html`, sin job en curso) — queda
`attachTo` en design-state. `designChat` inyecta la `api-surface` del
backend en el prompt del diseñador (endpoints reales, sin mocks) y el
vite del workspace ya proxea `/api`→`:4000` (preview contra la API si
su dev-run corre — `GET /api/design` devuelve `backend:{slug,
apiRunning}` y la UI muestra chip "api on/off :4000" que togglea
`run-dev`/`stop-dev` sobre ese slug). `POST /api/design/save` en modo
attach ignora el slug
del body: copia el front dentro de `generated-apps/<attachTo>` (merge
de `package.json` por clave — el backend gana en clashes; `server/`,
`AGENTS.md`, `.gitignore` nunca se pisan), `plan.scope→fullstack` +
`stacks.frontend` + compliance base + step frontend `done`, y
`writeAgentsMd` re-escribe AGENTS.md con sección backend+front.

Propuestas del agente (`proposal`): `designer.md` instruye al agente
a cerrar su reply con un bloque fenced ` ```proposal ` JSON —
`{question, options:[{label, reply?, action?}]}` — cuando necesita
una decisión del usuario o quiere ofrecer próximos pasos. La UI lo
parsea con `parseProposal` (util.js): texto limpio al bubble + card
con botones (`reply` → lo envía como mensaje; `action` → nativa:
`save` enfoca el slug-guardar, `preview` levanta el dev server;
desconocida → fallback reply con el label). Guard-rails: solo
mensajes del agente (el input del usuario nunca se parsea), máx 4
opciones, JSON malformado → texto plano. Cero cambios de contrato —
es texto dentro del stream SSE.
