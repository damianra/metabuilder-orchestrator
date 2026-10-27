# MetaBuilder — Roadmap v4

## Estado

v1, v2 y v3 completas y mergeadas: pipeline LangGraph end-to-end,
verticales `landing`/`orders`/`blog`/`custom`, `api-skeleton` (Express 5
+ SQLite), registry de stacks, patrones de arquitectura backend,
Dockerfile por app, dashboard funcional con terminal Devin embebida,
feed en vivo del agente, cola con cancel/requeue, dev-run local,
doctor de prereqs. Registro histórico: `docs/archive/ROADMAP-v1.md`,
`docs/archive/ROADMAP-v2.md` y `docs/archive/ROADMAP-v3.md`.

## Visión v4

De **"Devin como único agente"** a **"cualquier agente ACP"**. El
orquestador hoy está acoplado a `devin acp` en cada nodo generativo
(builder/fixer/reviewer/planner/validate-pr) y en la terminal del
dashboard. La v4 introduce un **registry de engines** al estilo
`src/stacks/`/`src/arch/` y vuelve agnóstico al pipeline: OpenCode
(`opencode acp`, verificado empíricamente contra v2.1.4 — mismo
JSON-RPC ACP v1, `session/set_config_option` con mode/model incluido)
pasa a ser una alternativa instalable localmente. El dashboard gana un
**setup gate obligatorio**: sin engine elegido no se puede trabajar.
Decisión clave: se usa **ACP, no `opencode run --format json`** — el
`AcpClient` + pool + parser de updates existentes se reusan verbatim.

## Backlog priorizado — todas mergeadas (PRs #52-#58)

| # | Tarea | Descripción | Esfuerzo |
| --- | --- | --- | --- |
| 1 ✅ | **Registry de engines + ACP compartido** | `src/engines/` (`devin.js`, `opencode.js`, `index.js` con `resolveEngine`/`listEngines`) como datos: bin, acpArgs, auth (`windsurf-api-key` vs skip), defaultMode (`bypass`/`build`), defaultModel, tuiArgs. Extraer `AcpClient` + pool + `withTimeout` de `src/tools/devin.js` a `src/tools/acp.js` parametrizado por engine (pool keyed por engine id; `authenticate` solo si el engine lo declara; `auth_required` → mensaje "ejecutá `opencode auth login`"). Call sites (`builder`/`fixer`/`reviewer`/`planner`×2/`validate-pr`) pasan a `runAgentPrompt`. `checkDevinAuth` → `checkEngineAuth(engineId)`. Preflight resuelve engine (env `AGENT_PROVIDER`, default devin) y chequea su bin+auth. | L |
| 2 ✅ | **Selección de engine: flag + estado + settings** | `--agent devin|opencode` → `state.agent` → `plan.agent` persiste (mismo patrón que `plan.stacks`; resume lo restaura). `src/tools/settings.js` lee/escribe `settings.json` (raíz, gitignored — no `.env`: se relee en runtime y no se toca el archivo de secretos). Precedencia: flag > plan > settings > `AGENT_PROVIDER` env > `auto` (devin si autentica, sino opencode). `.env.example` + `config.js` con `OPENCODE_BIN`/`OPENCODE_MODEL`. | M |
| 3 ✅ | **Setup gate obligatorio en el dashboard** | `GET /api/engines` con probe por engine (bin + auth, cache 30s); `POST /api/settings` persiste el engine; `POST /api/runs` 400 si no hay engine resoluble. UI `SetupGate`: a pantalla completa si `options.engine` es null — cards Devin/OpenCode con estado del probe, links a docs de instalación, botón "re-chequear"; chip "motor: \<label\>" en el header para cambiar. `GET /api/options` expone `engines` + `engine`. | M |
| 4 ✅ | **Terminal multi-engine** | `terminal.js` recibe `?engine=` y spawnea el TUI correspondiente (`devin` / `opencode`); sesiones keyed `slug:engine`; mismo slot del semáforo. `TerminalPanel` con selector (default = engine configurado, deshabilita el no-instalado). | S |
| 5 ✅ | **Doctor multi-engine** | `runDoctor` reporta ambos engines (bin + probe de auth por engine); fail solo si el engine efectivo no funciona o ninguno resuelve. | S |
| 6 ✅ | **Docs + tests de la integración** | README: sección "Motores de agente" (links devin.ai/opencode.ai + instalación: `devin auth login`/credentials.toml vs `opencode auth login`), flag `--agent`, vars `.env`, gate del dashboard. AGENTS.md con la arquitectura nueva. Tests: adapter opencode (spawn stubeado — verifica sin `authenticate`, mode `build`, parseo de updates), `resolveEngine` (precedencia), settings read/write. E2E manual `npm start -- --agent opencode`. | M |

## Backlog v5 — propuestas de pulido — todas mergeadas

| # | Tarea | Tipo | Esfuerzo |
| --- | --- | --- | --- |
| 1 ✅ | **Shutdown robusto de `npm run dashboard`** — dev.js espera `close` (~3s) y escala `SIGKILL` a los grupos. | fix | S |
| 2 ✅ | **Clamp de `?tail`** en `tailFile` — `Math.max(1, …)` en los endpoints que lo usan. | fix | S |
| 3 ✅ | **`clearJobs` barre huérfanos** — `<id>.log` sin `<id>.json` y `*.tmp-*` en `jobs/`. | fix | S |
| 4 ✅ | **`publish` async con estado en disco** — publish.json/publish.log en la app (patrón dockerize/test), 202 inmediato, 409 con pid vivo, stale-aware. | mejora | M |
| 5 ✅ | **Paridad podman en `--verify-docker`** — probe docker→podman. | mejora | S |
| 6 ✅ | **"sesión Devin" → label del engine** en mensajes de history/activity. | mejora | S |
| 7 ✅ | **Tests de componentes del dashboard** — QueuePanel, SetupGate, ProjectList (Testing Library). | mejora | M |
| 8 ✅ | **Log expandible por job en QueuePanel** — tail inline + createdAt y duración. | UI | M |
| 9 ✅ | **Links clickeables en notices + chip `repo` en ProjectList** — `hasRemote` en `GET /api/projects`. | UI | S/M |
| 10 ✅ | **Filtro en ProjectList** — por slug y status. | UI | S |
| 11 ✅ | **Handlers `error` en streams de log** — docker-build.log, test-run.log y logStream del worker quedaban con `error` unhandled; además los writes de estado en callbacks async (`writeBuildState`/`writeTestState`/`writeDevState`/publish) eran uncaught ante app borrada a mitad de operación → `tryWriteJson` best-effort. | fix | S |
| 12 ✅ | **Split de `AGENTS.md`** (>16KB, se truncaba al inyectarse como regla) → raíz como índice + reglas operativas, detalle en `docs/pipeline.md`, `docs/generation.md`, `docs/engines.md`, `docs/dashboard.md`. | docs | M |

## Heredado de v2/v3 (sigue fuera de scope)

- **orders con delivery real**: costo por zona/mapa, persistir pedido en
  Sheets, panel admin.

## Evaluación futura (fuera del roadmap por ahora)

- **Más engines ACP**: `claude-code`, `gemini-cli` — si hablan ACP v1
  entran como datos en `src/engines/` sin tocar el pipeline.
- **Chat nativo (ACP) en lugar de terminal embebida**: chat propio
  sobre `session/prompt` con diffs y permisos visibles — mucho más
  trabajo pero UI nativa. Más atractivo ahora que el engine es
  intercambiable.
- **`session/resume`/`session/load` de opencode** para darle contexto
  entre pasos del builder (capability confirmada en su ACP — hoy cada
  paso es una sesión nueva y eso es intencional).
- **NestJS / Expo**: mismo análisis que v3 — cambian contratos de
  verify/deploy, cambios a grandes rasgos.

## Decisiones tomadas

- **ACP, no `opencode run --format json`**: el ACP de opencode v2.1.4
  fue verificado en vivo (initialize → session/new → set_config_option
  mode/model → session/prompt con `agent_message_chunk` +
  `usage_update` + `stopReason`). Reusar el cliente existente gana
  contra escribir un parser de eventos nuevo.
- **`authenticate` se omite para opencode**: usa los providers de
  `opencode auth login`; un `auth_required` en `session/prompt` se
  mapea a error accionable.
- **`settings.json` y no `.env`** para la elección del dashboard:
  mutable en runtime sin reiniciar el server y sin reescribir secretos.
- **Gate solo en el dashboard**: el CLI mantiene default `auto` —
  jobs/colas/CI existentes no se rompen.
- **Un solo semáforo de agente**: devin y opencode comparten slot
  (`~/.metabuilder/devin-slots/`, nombre heredado) — nunca más de una
  sesión de agente a la vez en la máquina, mezclando engines.
