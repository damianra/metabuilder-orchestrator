# Engines de agente (ACP)

Los nodos generativos hablan con un **engine ACP** via `runAgentPrompt({agent, ...})` de `src/tools/acp.js` — el mismo cliente
para todos. El engine se declara como datos en `src/engines/<id>.js`
(bin, `acpArgs`, `authParams`, `defaultMode`/`defaultModel`, `tuiArgs`,
`strictConfig`, `docsUrl`/`installHint`/`authHint` — estos últimos son
los links y comandos que el setup gate del dashboard muestra en las
cards del engine) + entrada en el `Map` de `src/engines/index.js` —
`resolveEngineId` decide: `--agent` (state.agent) > `settings.json`
(si no es `auto`) > `AGENT_PROVIDER` > `plan.agent`
(resume) > `settings.json` `engine` (`src/tools/settings.js` — el
dashboard lo escribe, gitignored) > `AGENT_PROVIDER` > `'auto'` —
auto sonda cada engine con `checkEngineAuth` y gana el primero que
autentica (preflight; en callers sin sonda `resolveEngine` mapea
auto/'' → devin). `plan.agent` se sella al crear/resumir el plan
(mismo patrón que `plan.stacks`). Pool de procesos keyed por engine
id; el semáforo (`devin-lock.js`) es compartido entre engines.

- `devin` (`devin acp`): authenticate `windsurf-api-key`, mode `bypass`.
- `opencode` (`opencode acp`, verificado v2.1.4): **sin authenticate**
  (usa providers de `opencode auth login`; `auth_required` → hint),
  mode `build`, model = default del provider salvo `OPENCODE_MODEL`.

## Devin CLI

**No usar `devin -p` / `--print`.** Ese modo exige `session_token` de
cuenta Devin (`app.devin.ai`) que las cuentas Windsurf no producen:
falla con "Not logged in" aunque `credentials.toml` exista y sea válido.

La vía soportada es **`<engine> acp`** (JSON-RPC sobre stdio), igual que
Devin Desktop. Secuencia (`src/tools/acp.js`):

1. `initialize` (protocolVersion 1, `clientCapabilities: {}`)
2. `authenticate` — solo si el engine declara `authParams` (Devin:
   `{ methodId: "windsurf-api-key", _meta: { api_key, api_server_url } }`
   leídos de `~/.local/share/devin/credentials.toml`; OpenCode lo salta).
3. `session/new` `{ cwd, mcpServers: [] }` (`cwd` absoluto — opencode
   rechaza relativos)
4. `session/set_config_option` mode/model con los defaults del engine
   (Devin: `bypass`/`swe-2-high`; OpenCode: `build`/default del provider)
5. `session/prompt` con `{ prompt: [{ type: "text", text }] }`
6. Respuesta = concatenar `session/update` con
   `sessionUpdate === "agent_message_chunk"`; fin = resultado con `stopReason`.

## Notas ACP

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
  en `tools/acp.js` (`warmClient`, keyed por engine) — initialize+authenticate una sola
  vez, `setLog` rota el run log por paso. Si el proceso muere (crash o
  kill por timeout) se descarta y el próximo paso respawnea solo. La
  memoria entre pasos es el filesystem + `plan.json` + el AGENTS.md
  copiado. El semáforo sigue limitando sesiones activas, no procesos
  idle — un proceso tibio sin sesión no bloquea a otros runs.
- `devin auth status` y `devin models list` reportan "Not logged in" con
  credenciales Windsurf — es un chequeo de session_token, **no usar como
  probe**. El probe real es `checkEngineAuth()` (initialize+authenticate).

## Semáforo de sesiones de agente

(`src/tools/devin-lock.js`): `runAgentPrompt`
adquiere un slot de `~/.metabuilder/devin-slots/slot-N/` antes del spawn
(mkdir atómico + pid file; slots de procesos muertos se reciclan). Con
`MAX_CONCURRENT_DEVIN_SESSIONS=1` (default) nunca hay más de una sesión
`<engine> acp` a la vez en toda la máquina (mezclando engines), aunque corran varios `npm start`
— se serializan solos. `checkEngineAuth` no consume slot (handshake de ~1s
sin trabajo de agente).

### Precedencia del engine en resume (v13)

`resolveEngineId`: `--agent` flag > `settings.json` (si no es `auto`) > `AGENT_PROVIDER` > `plan.agent` > `auto`. El engine **activo** siempre gana sobre el guardado en `plan.json` — `plan.agent` queda como fallback histórico. Un run creado con un engine que luego quedó sin tokens se desbloquea cambiando `settings.json` (o `--agent`), sin editar el plan.
