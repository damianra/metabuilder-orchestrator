import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { config } from '../config.js';
import { resolveEngine } from '../engines/index.js';
import { acquireDevinSlot } from './devin-lock.js';

/**
 * Cliente ACP mínimo compartido por los engines (src/engines/).
 *
 * Devin (`devin acp`) y OpenCode (`opencode acp`) hablan el mismo
 * Agent Client Protocol — JSON-RPC delimitado por líneas sobre stdio —
 * así que el transporte, el pool y el parser de updates son comunes;
 * lo que cambia por engine es: binario/args, si hay `authenticate`
 * (Devin: windsurf-api-key de credentials.toml; OpenCode: skip — usa
 * los providers de `opencode auth login`) y los valores de
 * session/set_config_option (mode `bypass` vs `build`, model).
 *
 * Secuencia: initialize → authenticate (si el engine lo declara) una
 * sola vez por proceso (pool, ver warmClient); luego por llamada:
 * session/new → session/set_config_option (mode/model) →
 * session/prompt → acumular session/update hasta que el prompt
 * responde.
 */
export class AcpClient {
  #proc;
  #buffer = '';
  #pending = new Map();
  #nextId = 1;
  #log;
  #alive = true;
  onUpdate;

  constructor(engine, cwd, logPath) {
    this.#proc = spawn(engine.bin, engine.acpArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.setLog(logPath);
    this.#proc.stdout.on('data', (chunk) => this.#onData(chunk));
    this.#proc.stderr.on('data', (chunk) => this.#writeLog(`[stderr] ${chunk}`));
    // spawn ENOENT (binario ausente): sin handler 'error' el
    // evento es uncaught y tumba el proceso entero antes de que el
    // caller vea nada — doctor/preflight necesitan el error limpio.
    this.#proc.on('error', (err) => {
      this.#alive = false;
      const pending = [...this.#pending.values()];
      this.#pending.clear();
      for (const settle of pending) {
        settle({ error: { message: `${engine.bin} ${engine.acpArgs.join(' ')} no arrancó: ${err.message}` } });
      }
    });
    // Si el proceso muere, las calls pendientes no pueden quedar
    // colgadas — se rechazan y el pool descarta al cliente.
    this.#proc.on('exit', () => {
      this.#alive = false;
      const pending = [...this.#pending.values()];
      this.#pending.clear();
      for (const settle of pending) {
        settle({ error: { message: `proceso ${engine.id} acp terminó` } });
      }
    });
  }

  get isAlive() {
    return this.#alive && this.#proc.exitCode === null && !this.#proc.killed;
  }

  get pid() {
    return this.#proc.pid;
  }

  // Rota el archivo de log JSON-RPC sin reiniciar el proceso — el pool
  // lo usa para que cada paso siga escribiendo a su propio run log.
  setLog(logPath) {
    this.#log?.end();
    this.#log = logPath ? createWriteStream(logPath, { flags: 'a' }) : null;
    // El stream puede fallar (ENOSPC, etc.) — el log nunca debe tumbar la sesión.
    this.#log?.on('error', () => {});
  }

  // El proceso puede seguir emitiendo stderr/stdout tras close() (end del
  // log stream) — escribir solo si sigue abierto. Un WriteStream con
  // 'error' sin listener tira ERR_STREAM_WRITE_AFTER_END y mata el proceso.
  #writeLog(chunk) {
    try {
      if (this.#log && !this.#log.writableEnded && !this.#log.destroyed) {
        this.#log.write(chunk);
      }
    } catch {
      /* el log nunca debe romper la sesión */
    }
  }

  #onData(chunk) {
    this.#writeLog(chunk);
    this.#buffer += chunk;
    let idx;
    while ((idx = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, idx).trim();
      this.#buffer = this.#buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.#pending.has(msg.id)) {
        this.#pending.get(msg.id)(msg);
        this.#pending.delete(msg.id);
      } else if (msg.method === 'session/update') {
        this.onUpdate?.(msg.params);
      } else if (msg.method === 'session/request_permission') {
        // Red de seguridad: aun en modo bypass, aprobar la primera opción.
        this.#send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            outcome: { outcome: 'selected', optionId: msg.params.options[0].optionId },
          },
        });
      } else if (msg.id !== undefined && msg.method) {
        // Request agente→cliente no manejada (fs/*, terminal/*, etc.):
        // responder error para no dejar al agente colgado.
        this.#send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `method not implemented: ${msg.method}` },
        });
      }
    }
  }

  #send(msg) {
    this.#writeLog(`[client→] ${JSON.stringify(msg)}\n`);
    this.#proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  call(method, params) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (m) =>
        m.error ? reject(new Error(m.error.message ?? JSON.stringify(m.error))) : resolve(m.result),
      );
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  kill() {
    this.#proc.kill('SIGKILL');
  }

  close() {
    this.#proc.stdin.end();
    this.#log?.end();
  }

  // close + kill: para descartar un cliente del pool.
  dispose() {
    this.close();
    this.kill();
  }

  // Un cliente tibio en el pool no debe mantener vivo el event loop
  // (scripts/tests colgarían al terminar). Se unref() al quedar idle y
  // se ref() mientras corre un prompt.
  ref() {
    this.#proc.ref();
    this.#proc.stdin.ref();
    this.#proc.stdout.ref();
    this.#proc.stderr.ref();
  }

  unref() {
    this.#proc.unref();
    this.#proc.stdin.unref();
    this.#proc.stdout.unref();
    this.#proc.stderr.unref();
  }
}

// ---- Pool de procesos `<engine> acp` (keyed por engine id) ----
// Spawn + initialize + authenticate cuestan segundos por llamada y el
// resultado es el mismo para todos los pasos de un run → se mantiene
// un proceso tibio por engine a nivel módulo y cada prompt abre una
// sesión ACP nueva (session/new): el aislamiento entre pasos no
// cambia, lo que se ahorra es el handshake. Si el proceso muere
// (crash, kill por timeout) se descarta y el próximo prompt
// respawnea. El semáforo sigue por prompt — limita sesiones activas,
// no procesos idle.
const acpPool = new Map(); // engineId → client
let exitHookInstalled = false;

function dropPooledClient(client) {
  for (const [id, c] of acpPool) if (c === client) acpPool.delete(id);
  client.dispose();
}

export function acpPoolStats(engineId = 'devin') {
  const client = acpPool.get(engineId);
  return {
    warm: Boolean(client?.isAlive),
    pid: client?.isAlive ? client.pid : null,
  };
}

async function warmClient(engine, cwd, logPath) {
  const pooled = acpPool.get(engine.id);
  if (pooled?.isAlive) {
    pooled.setLog(logPath);
    pooled.ref();
    return { client: pooled, reused: true };
  }
  if (pooled) dropPooledClient(pooled);
  const client = new AcpClient(engine, cwd, logPath);
  try {
    // Sin fs/terminal capabilities: el agente usa sus tools nativos
    // que corren server-side en `cwd`. Si las anunciamos, el agente
    // delega cada fs op al cliente y se bloquearía esperando
    // respuestas que nunca llegan.
    await client.call('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'metabuilder-orchestrator', version: '0.1.0' },
    });
    // authenticate solo si el engine lo declara (Devin:
    // windsurf-api-key; OpenCode: null — usa `opencode auth login`).
    const authParams = engine.authParams?.();
    if (authParams) await client.call('authenticate', authParams);
  } catch (err) {
    client.dispose();
    throw err;
  }
  acpPool.set(engine.id, client);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Sin esto un Ctrl+C/exit del CLI dejaría los `* acp` huérfanos.
    process.on('exit', () => {
      for (const c of acpPool.values()) {
        try {
          c.kill();
        } catch {
          /* ya muerto */
        }
      }
    });
  }
  client.ref();
  return { client, reused: false };
}

async function startSession(engine, { cwd, logPath, model, mode, onActivity }) {
  const { client, reused } = await warmClient(engine, cwd, logPath);
  const session = await client.call('session/new', { cwd, mcpServers: [] });
  const setOpt = async (configId, value) => {
    if (!value) return;
    try {
      await client.call('session/set_config_option', {
        sessionId: session.sessionId,
        configId,
        value,
      });
    } catch (err) {
      // strictConfig (Devin): el modo bypass es parte del contrato —
      // un fallo acá es error real. No-strict (OpenCode): el default
      // ya es usable, se sigue con un warning.
      if (engine.strictConfig) throw err;
      onActivity?.(`${engine.label}: config '${configId}' ignorada (${err.message})`);
    }
  };
  await setOpt('mode', mode ?? engine.defaultMode);
  await setOpt('model', model ?? engine.defaultModel);
  return { client, sessionId: session.sessionId, reused };
}

/**
 * Ejecuta un prompt contra el engine resuelto en `cwd` y espera el fin
 * del turno. `agent` puede ser un id ('devin'|'opencode'), un engine
 * resuelto o vacío (resolveEngine: env AGENT_PROVIDER → 'devin').
 * Devuelve { ok, text, stopReason, sessionId, engine, error? }.
 */
export async function runAgentPrompt({
  agent,
  prompt,
  cwd,
  timeoutMs = config.devinTimeoutMs,
  model,
  mode,
  logPath,
  onText,
  onActivity,
}) {
  let client;
  let engine;
  const textParts = [];
  // Semáforo global: nunca más de `maxDevinSessions` sesiones ACP a la
  // vez en toda la máquina (default 1), mezclando engines — dos
  // `npm start` concurrentes se serializan acá igual.
  const releaseSlot = await acquireDevinSlot({
    onWait: () => onActivity?.('esperando slot de sesión de agente (otro run en curso)…'),
  });
  try {
    engine = resolveEngine(typeof agent === 'string' || !agent ? agent : agent.id);
    const started = await startSession(engine, { cwd, logPath, model, mode, onActivity });
    client = started.client;
    const sessionId = started.sessionId;
    if (started.reused) {
      onActivity?.(`proceso ${engine.id} acp reutilizado (handshake omitido)`);
    }

    // Dedup + throttle de actividad: los tool_call pueden llegar en ráfagas.
    let lastActivity = '';
    let lastActivityTs = 0;
    const reportActivity = (label) => {
      if (!onActivity || !label || label === lastActivity) return;
      const now = Date.now();
      if (now - lastActivityTs < 1500) return;
      lastActivity = label;
      lastActivityTs = now;
      onActivity(label);
    };

    client.onUpdate = (params) => {
      const u = params.update;
      if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
        textParts.push(u.content.text);
        onText?.(u.content.text);
        return;
      }
      if (u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update') {
        const file = u.locations?.[0]?.path?.split('/').slice(-2).join('/');
        const label = u.title || (u.kind ? `${u.kind}${file ? `: ${file}` : ''}` : file);
        reportActivity(label);
      }
    };

    const result = await withTimeout(
      client.call('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      }),
      timeoutMs,
      () => client.kill(),
    );

    return {
      ok: true,
      text: textParts.join(''),
      stopReason: result?.stopReason ?? 'end_turn',
      sessionId,
      reused: started.reused,
      engine: engine.id,
    };
  } catch (err) {
    let error = String(err?.message ?? err);
    // auth_required / similar: el engine declara cómo arreglarlo
    // (opencode → `opencode auth login`).
    if (engine?.authHint && /auth|login|permission/i.test(error)) {
      error += ` — ${engine.authHint}`;
    }
    return {
      ok: false,
      text: textParts.join(''),
      stopReason: null,
      sessionId: null,
      engine: engine?.id,
      error,
    };
  } finally {
    // El cliente NO se cierra: queda tibio en el pool para el próximo
    // paso. Solo se descarta si el proceso murió (timeout→kill, crash).
    if (client) {
      client.onUpdate = null;
      if (client.isAlive) client.unref();
      else dropPooledClient(client);
    } else if (engine && acpPool.get(engine.id)?.isAlive) {
      // startSession lanzó tras pool-ear el cliente (session/new o
      // set_config falló): quedó ref()'d sin dueño — hay que
      // descartarlo o retiene el event loop para siempre.
      dropPooledClient(acpPool.get(engine.id));
    }
    releaseSlot();
  }
}

/**
 * Probe de autenticación para preflight: initialize + authenticate
 * (si el engine lo declara). No consume slot del semáforo: es un
 * handshake de ~1s sin trabajo de agente (no llega a session/new).
 */
export async function checkEngineAuth(engineId, timeoutMs = 30_000) {
  let engine;
  let client;
  try {
    engine = resolveEngine(engineId);
    client = new AcpClient(engine, config.rootDir, null);
    await withTimeout(
      (async () => {
        await client.call('initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'metabuilder-orchestrator', version: '0.1.0' },
        });
        const authParams = engine.authParams?.();
        if (authParams) await client.call('authenticate', authParams);
      })(),
      timeoutMs,
      () => client.kill(),
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  } finally {
    client?.close();
  }
}

function withTimeout(promise, ms, onTimeout) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`timeout tras ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
