# MetaBuilder Orchestrator — guía para agentes

Orquestador multi-agente (Node.js ESM + LangGraph) que genera aplicaciones
básicas (landings, pedidos, blogs) delegando la escritura de código a
**Devin CLI via ACP**. Las apps generadas van a `generated-apps/<slug>/`
(gitignored, cada una con su propio repo git).

## Comandos

```bash
npm install
npm start -- --idea "..." --scope fullstack|frontend|backend [--name slug] [--no-push] [--keep-going]
node src/index.js            # modo interactivo (readline)
```

Verificación rápida de tools sin tocar el grafo:

```bash
node -e "import('./src/tools/devin.js').then(m=>m.checkDevinAuth().then(console.log))"
node -e "import('./src/tools/shell.js').then(m=>m.run('echo ok',{cwd:'/tmp'}).then(console.log))"
```

## Arquitectura

`src/orchestrator/graph.js` (LangGraph `StateGraph`):

```
preflight → plan → validate ─┬─→ build → verify ─┬─→ build (siguiente paso)
                             │                   ├─→ finalVerify → finalize → END
                             └─→ repairPlan      └─→ fix → verify
```

- Estado: `src/orchestrator/state.js` (`Annotation.Root`).
- Nodos: `src/agents/*.js` (un archivo por nodo).
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

1. `initialize` (protocolVersion 1, `fs`+`terminal` capabilities)
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

## Troubleshooting conocido

- **Playwright browsers**: en la app generada `npx playwright install
  chromium` (sin `--with-deps`, requiere sudo). Si faltan libs del SO:
  `sudo npx playwright install-deps chromium`.
- **Timeout de paso**: `DEVIN_TIMEOUT_MS` (default 15 min).
- **Push**: solo si `GITHUB_REPO_URL` (SSH) está seteada y repo existe.
