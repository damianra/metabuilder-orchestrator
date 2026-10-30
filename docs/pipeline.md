# Pipeline — grafo LangGraph

`src/orchestrator/graph.js` (LangGraph `StateGraph`):

```
preflight → planner → validate ─┬─→ confirm → builder → verify ─┬─→ builder (siguiente paso)
                                │                               ├─→ finalVerify → smoke ─┬─→ review → finalize → END
                                └─→ repairPlan                  └─→ fixer → verify        └─→ fixer
```

Fail terminal: fallos de transporte/timeout del planner y reintentos
agotados van al nodo `fail` (status: failed), no a repairPlan.

`review` es el sub-agente QA (prompts/reviewer.md): sesión del engine
de agente que inspecciona la app contra AGENTS.md + idea. El prompt
lleva scope — inventario de archivos fuente + api-surface + captura
`screenshot.png` del build como evidencia visual (warn-only; se
REcaptura en cada pasada porque el fix-loop rebuildea `dist/`).
Responde `RESULT: APPROVED`
(→ finalize) o `RESULT: ISSUES` (→ fixer corrige, consume finalRetries,
vuelve a finalVerify). El repo remoto se crea recién en finalize: evita
repos vacíos si el pipeline falla antes.

## Nodos y estado

- Estado: `src/orchestrator/state.js` (`Annotation.Root`).
- Nodos: `src/agents/*.js` (un archivo por nodo). Helpers compartidos
  (log, readPlan/writePlan, loadPrompt): `src/agents/common.js`.
- **LangGraph prohíbe que un nodo se llame igual que un canal de estado.**
  Por eso el nodo se llama `planner` (el canal `plan` guarda el plan.json).
- `verifying` en el estado distingue verificación por paso (`'step'`) de la
  final (`'final'`) — `fix` vuelve a `verify` o a `finalVerify` según eso.
- Todo fallo terminal va al nodo `fail` (setea `status: 'failed'`), nunca
  directo a END sin marcar estado.
- Tools: `src/tools/` (`acp.js` cliente ACP compartido, `shell.js` execa, `slug.js`,
  `install.js` install lazy por toolchain, `github.js` REST).
- Prompts versionables: `src/prompts/*.md`.
- `src/templates/AGENTS.md` se **copia a cada app generada** con las reglas
  de UI obligatorias — no confundir con el AGENTS.md de la raíz, que
  documenta el orquestador.
- `runs/<runId>/` guarda logs JSON-RPC de cada sesión ACP.
  `npm run report -- <runId|slug>` los resume en `report.md` (pasos,
  intentos, duración por sesión); sin args lista runs recientes.

## Install lazy

El install corre **lazy en background** (`src/tools/install.js`:
`startInstall`/`awaitInstall`/`isInstalling`, registry por (dir,
comando)) — overlap con planner + confirmación humana. Qué comando
corre y sobre qué manifest lo decide el `toolchain` de cada stack
activo (`installCommands(dir, stacks)` en `tools/docker.js` — hoy todo
es `npm install` sobre `package.json`; un stack python declara el
suyo). `builder`, `verifier` y `finalVerify` los awaitan antes de
tocar las deps. Si el scope tiene frontend también se pre-calienta
`npx playwright install chromium` en background (nunca se awaita; el
paso e2e lo reintenta si hace falta).

## Confirmación de plan

El nodo `confirm` usa `interrupt()` (LangGraph + `MemorySaver`): el grafo
suspende tras validar, el CLI muestra el plan y espera `[S/n]`; resume via
`Command({ resume })`. Se activa solo si stdin es TTY y no se pasó `--yes`.
Rechazar → `fail` sin ejecutar builds.

## plan.json (checkpoint dentro de cada app generada)

```json
{
  "projectName": "task-app",
  "scope": "fullstack|frontend|backend",
  "appType": "landing|orders|blog|custom",
  "idea": "...",   // restaurada por --resume (planner la persiste al crear el plan)
  "arch": "flat",  // patrón backend (--arch); resume lo restaura
  "stacks": { "frontend": "vite-react", "backend": "express-sqlite" }, // idem
  "agent": "devin",  // engine ACP que lo generó (--agent); resume lo restaura
  "deploy": { "github": true, "pages": true },  // --github/--ghpages del run; resume lo restaura
  "compliance": ["privacidad","notfound"],  // perfiles activos; resume los restaura (o los infiere si falta)
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

En resume, `preflight` además copia los overlays de compliance que
falten (apps pre-v7 o `--compliance` nuevo) — solo archivos ausentes,
nunca pisa lo que el builder pudo personalizar.

## `--extend <slug>` — frontend → fullstack

Resume + inyección de pasos backend sobre un proyecto frontend
existente (p.ej. un diseño guardado desde la pestaña Diseñar app):

1. **CLI** (`src/index.js`): resuelve el dir como `--resume`, error si
   ya tiene `server/`, `state.extend=true`. `--idea` opcional describe
   el dominio de la API (fallback: `plan.idea`).
2. **preflight**: si `extend` y falta `server/` → `copyApiSkeleton`
   (mergea `package.partial.json` sobre el package.json existente,
   copia `server/`, appenda `.gitignore` — nunca pisa). AGENTS.md y
   Dockerfile se re-escriben por detección (`server/` → sección
   backend + `Dockerfile.fullstack`), como en cualquier resume.
3. **planner** (rama `state.extend`): sesión de agente con
   `prompts/extend-backend.md` — lee `src/` para conocer los datos
   mock de la UI y appendea pasos `backend` (schema/seed/routes sobre
   el api-skeleton) + paso `frontend` de **integración** (reemplazar
   mocks por `fetch` a `/api/*`) + `test` + `e2e`. Del archivo que
   escribe el agente solo se toma la cola de steps (los `done`
   originales quedan verbatim). Después `normalizeExtendedPlan`
   (`src/tools/extend-plan.js`) aplica lo determinístico:
   `scope→fullstack`, `validated=false` (re-valida el plan fusionado),
   `stacks.backend/frontend`, sufijo canónico de keywords en pasos
   frontend (cubre requirements 'each'/`some` y el step legacy de
   saveDesign), renumeración de ids. Luego el resume común:
   `applyArch`/`applyCompliance` parchean lo que falte (misma red de
   seguridad que `repairPlan`) → validate → builder → verify → resto
   del pipeline sin cambios.
4. **Semántica de `plan.validated`**: el validator saltea los
   requirements de completitud cuando `validated === true` (lo escribe
   el validator al pasar y `saveDesign` al emitir el plan sintético) —
   el chequeo estructural corre siempre. Así un `--resume` de un
   diseño guardado no cae en `repairPlan` solo por keywords.

`finalVerify` corre la batería que arma `finalCheckCommands` desde el
`toolchain` de cada stack (build → test → e2e, dedup por comando):
hoy `npm run build` + `npx vitest run` + `npm run test:e2e` (solo si
hay frontend; backend solo vitest). Falla → loop `fix`
(finalRetries) → `fail`.

`smoke` (v13) es verificación **runtime** del artifact final, entre
`finalVerify` OK y `review`: levanta el `devCmd` del toolchain del stack
(spawn detached, kill del process group al terminar — nunca huérfano),
espera el puerto (~30s) y verifica el contrato HTTP — `GET /api/health`
→ 200, cada `GET` del `apiSurface` del stack → no-404, `/api/*`
desconocida → 404 JSON, y si existe `dist/`/`out/` → `GET /` 200 +
deep route → `index.html` (SPA fallback). Severidad por DB: **embebida
(sqlite) → estricto** — cualquier check falla → `fail`; **externa
(postgres/mysql/mongo) → warn-only en la capa de datos** — un endpoint
5xx es warn y un boot que no levanta es skip+warn, porque la regla del
workflow es que la validación nunca depende de servicios/credenciales
reales (wiring sí sigue fallando: 404s y SPA roto siempre fallan).
Frontend-only → `GET /` 200 sobre el dev server. Si el puerto ya está
ocupado por otro proceso → skip seguro (imposible distinguir server
propio de ajeno). Opt-out: `--no-smoke` (canal `smokeEnabled`) o
`plan.smoke === false`. El resultado queda en el canal `smokeResult`
+ history del run. Implementación: `src/tools/smoke.js` (deps
inyectables) + `src/agents/smoke.js`.

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
