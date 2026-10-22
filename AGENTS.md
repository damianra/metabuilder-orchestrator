# MetaBuilder Orchestrator — guía para agentes

Orquestador multi-agente (Node.js ESM + LangGraph) que genera aplicaciones
básicas (landings, pedidos, blogs) delegando la escritura de código a
**Devin CLI via ACP**. Las apps generadas van a `generated-apps/<slug>/`
(gitignored, cada una con su propio repo git).

## Comandos

```bash
npm install
npm start -- --idea "..." --scope fullstack|frontend|backend \
            --app-type landing|orders|custom [--name slug] \
            [--github] [--no-push] [--keep-going] [-y|--yes]
```

Verificación rápida de tools sin tocar el grafo:

```bash
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
- `orders`: pedidos para casas de comida; soporta `fullstack` (Express +
  SQLite), `frontend` (datos mock) y `backend` (solo API).

## Skeleton de app

`src/templates/app-skeleton/` es un proyecto Vite+React+Tailwind+Vitest+
Playwright **funcional** que `preflight` copia a la app generada cuando el
vertical tiene frontend (scope ≠ backend), reemplaza `__APP_NAME__` y
corre `npm install`. El builder nunca hace scaffolding desde cero.
Nota: `vite.config.js` excluye `e2e/**` de Vitest — sin eso Vitest intenta
correr los specs de Playwright y falla.

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
- Tools: `src/tools/` (`devin.js` cliente ACP, `shell.js` execa, `slug.js`).
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
- Cada paso abre una sesión nueva (proceso `devin acp` propio). La memoria
  entre pasos es el filesystem + `plan.json` + el AGENTS.md copiado.
- `devin auth status` y `devin models list` reportan "Not logged in" con
  credenciales Windsurf — es un chequeo de session_token, **no usar como
  probe**. El probe real es `checkDevinAuth()` (initialize+authenticate).

## plan.json (checkpoint dentro de cada app generada)

```json
{
  "projectName": "task-app",
  "scope": "fullstack|frontend|backend",
  "appType": "landing|orders|blog|custom",
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

## Convenciones

- ESM (`"type": "module"`), Node >= 20, imports con extensión `.js`.
- `execa` siempre con `reject: false` en tools — los nodos deciden.
- Reintentos: paso ≤ `MAX_STEP_RETRIES` (3), plan ≤ `MAX_PLAN_RETRIES` (2).
- Nunca commitear `generated-apps/`, `runs/`, `.env`, `*.sqlite`.

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
