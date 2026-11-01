# MetaBuilder Orchestrator — guía para agentes

Orquestador multi-agente (Node.js ESM + LangGraph) que genera aplicaciones
básicas (landings, pedidos, blogs) delegando la escritura de código a un
**engine de agente via ACP** (Devin CLI u OpenCode). Las apps generadas van
a `generated-apps/<slug>/` (gitignored, cada una con su propio repo git).

Este archivo se inyecta como regla always-on y se trunca a ~16KB — se
mantiene como **índice + reglas operativas**; el detalle por dominio
vive en `docs/`. Al cambiar comportamiento, actualizar el doc del
dominio correspondiente (y este índice solo si cambia el mapa).

| Doc | Cubre |
| --- | --- |
| `docs/pipeline.md` | grafo LangGraph, nodos/estado, confirm, plan.json, verify/finalize, runs/report, troubleshooting |
| `docs/generation.md` | verticales, registry de stacks, patrones de arquitectura, skeletons, Dockerfile por app |
| `docs/engines.md` | registry de engines, protocolo ACP, pool de procesos, semáforo de sesiones, Devin CLI |
| `docs/dashboard.md` | API REST + WS del dashboard, UI, terminal, notificaciones |

## Comandos

```bash
npm install
npm start -- --idea "..." --scope fullstack|frontend|backend \
            --app-type landing|orders|blog|custom [--name slug] \
            [--arch flat|mvc|layers|feature] \
            [--stack-frontend vite-react|nextjs] \
            [--stack-backend express-sqlite] \
            [--compliance cookies|terminos|pagos|auth[,...]] \
            [--agent devin|opencode] \
            [--github] [--no-push] [--keep-going] [-y|--yes]

# Reanudar un run interrumpido desde su plan.json (ruta o slug):
npm start -- --resume generated-apps/<slug> [--github] [--no-push] [-y]

# Agregar backend a un proyecto frontend (appendea pasos al plan):
npm start -- --extend generated-apps/<slug> [--idea "..."] [--arch X] [--github] [-y]

# Cola batch: encolar ideas y procesarlas en serie
npm run queue -- add --idea "..." [-y]   # encola (args = los de npm start)
npm run queue -- list|clear              # estado / limpieza
npm run queue -- cancel <id>             # pending→cancelled; running→flag y el worker mata el árbol
npm run worker                           # procesa jobs/ en orden (una pasada)
npm run doctor                           # prereqs: bins + auth ACP (exit 1 si falta
                                         # algo obligatorio; engine/playwright/token/
                                         # node-pty son warnings)
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
node -e "import('./src/tools/acp.js').then(m=>m.checkEngineAuth('devin').then(console.log))"
node -e "import('./src/tools/shell.js').then(m=>m.run('echo ok',{cwd:'/tmp'}).then(console.log))"
```

## ⚠️ Reglas críticas (detalle en `docs/engines.md` / `docs/pipeline.md`)

- **Nunca escribir a un stream tras `end()`** — `ERR_STREAM_WRITE_AFTER_END`
  mata el proceso; los streams de log llevan `on('error')` y los writes de
  estado en callbacks async van por `tryWriteJson` (dashboard).
- **No anunciar capabilities `fs`/`terminal` en ACP** — el agente delega
  lectura/escritura al cliente y se cuelga; capabilities van vacías.
- **No usar `devin -p`/`--print`** ni `devin auth status` como probe —
  exigen session_token que Windsurf no produce; el probe es
  `checkEngineAuth()` (handshake ACP).
- **Un nodo no puede llamarse igual que un canal de estado** (LangGraph).
- Todo fallo terminal va al nodo `fail` (`status: 'failed'`), nunca a END.
- **Los procesos levantados para probar se detienen al terminar** —
  registrar pid/puerto al arrancar y antes de cerrar la tarea verificar
  con `pgrep -f`/`ss -ltn` que no queden procs/ports vivos; matar solo
  los propios, nunca los del usuario. Preferir `run-dev` del dashboard
  (queda trackeado en `dev-run.json`) sobre `nohup` sueltos.

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
   **La validación funcional del sub-agente es acotada al diff**:
   `vitest related` sobre los archivos tocados (suite completa solo
   para archivos hub: config/shell/acp/github/server/grafo/package),
   tests del dashboard solo si tocó `dashboard/`, nunca e2e (manual,
   `npm run test:e2e` en la app). El worktree se instala con
   `npm ci --prefer-offline` y al cerrar se pkill-ea lo que el agente
   haya dejado corriendo dentro de él.

5. **Validación funcional antes de merge — la hace un sub-agente**:
   `npm run validate:pr -- <N>` valida un PR puntual; `npm run
   validate:pr` sin args valida **todos los PRs abiertos pendientes**
   (auto-descubrimiento); `--watch [min]` hace polling continuo; `--engine <id>` fija el engine del sub-agente sin tocar `settings.json`
   (default 5 min). En todos los casos crea un worktree temporal del
   head, corre una sesión Devin (`prompts/pr-validator.md`) que revisa
   el diff + ejecuta la validación acotada (`vitest related`,
   `node --check`, smokes dirigidos — suite completa solo para
   archivos hub) y comenta el veredicto en el PR — embebido con
   `<!-- validate-pr head:<sha7> -->`, así un push nuevo vuelve a
   marcar el PR como pendiente. El `GITHUB_TOKEN` nunca llega al
   agente — solo lo usa el script para leer el PR y comentar.
   Solo se mergea con `✅ APROBADO PARA MERGE`.
   **No borrar la rama (local ni remota) hasta confirmar el merge**
   (`MERGED <sha>` — nunca encadenar `git push --delete`/`git branch -d`
   en el mismo comando: si el merge falla, borrar la head branch
   **cierra el PR automáticamente** y reabrir+recuperar cuesta más).
   Borrar solo en un paso posterior, verificado el sha en `main`.
   **Push post-aprobación invalida el merge**: el veredicto lleva
   `<!-- validate-pr head:<sha7> -->` — un push nuevo deja el PR
   "pendiente" y el merge puede rechazarse ("head out of date");
   tras cualquier push extra hay que re-correr `validate:pr` o
   mergear solo si el cambio no tocó código aprobado.

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
  actualizar `README.md`, el doc de dominio en `docs/` (o este
  `AGENTS.md` si es regla operativa) y `ROADMAP.md` (si aplica).
  Un PR de código sin sus docs está incompleto.
