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
            [--github] [--no-push] [--keep-going] [-y|--yes]

# Reanudar un run interrumpido desde su plan.json (ruta o slug):
npm start -- --resume generated-apps/<slug> [--github] [--no-push] [-y]
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

## Skeleton de app

`src/templates/app-skeleton/` es un proyecto Vite+React+Tailwind+Vitest+
Playwright **funcional** que `preflight` copia a la app generada cuando el
vertical tiene frontend (scope ≠ backend) y reemplaza `__APP_NAME__`.
El builder nunca hace scaffolding desde cero.
Nota: `vite.config.js` excluye `e2e/**` de Vitest — sin eso Vitest intenta
correr los specs de Playwright y falla. Además proxea `/api` y `/uploads`
a :4000 (config muerta si el scope no tiene backend).

`src/templates/api-skeleton/` es el equivalente de backend: Express 5 +
better-sqlite3 + multer, auto-mount de `server/routes/<name>.js` en
`/api/<name>`, `schema.sql` + `seed-data.js` (seed solo si la tabla está
vacía), `POST /api/uploads` → `/uploads/<file>`. `preflight` lo copia
cuando el scope tiene backend (standalone si scope=backend — el
`package.partial.json` pasa a `package.json`; overlay sobre app-skeleton
si fullstack — mergea deps/scripts). Si el vertical tiene
`src/verticals/<v>/api/` (schema.sql, seed-data.js, routes/) se copia
encima de `server/`. También aplica a `appType: 'custom'` con backend.

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

React+Vite+Tailwind / Express / SQLite / Vitest / Playwright (e2e solo si
hay frontend). Ver `src/templates/AGENTS.md` para las 5 reglas de UI que el
código generado debe cumplir y que Playwright verifica.

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
   `dist/` → rama `gh-pages` (repo git propio dentro de dist/) +
   `POST /repos/{o}/{r}/pages` → `https://<user>.github.io/<repo>/`.
   Solo scopes con frontend; vite.config usa `base: './'` por eso.
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
  "already enabled" — ambos son OK, verificar con GET.
- **Commit en re-runs**: si la app ya tiene todo commiteado, el finalize
  salta el commit vía `git diff --cached --quiet`.
