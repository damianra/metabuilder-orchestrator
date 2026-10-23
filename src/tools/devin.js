import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { config } from '../config.js';

/**
 * Cliente ACP mínimo para Devin CLI.
 *
 * `devin -p` requiere un session_token de cuenta Devin que las cuentas
 * Windsurf no producen. La vía soportada para esas credenciales es
 * `devin acp` (Agent Client Protocol, JSON-RPC delimitado por líneas
 * sobre stdio) — el mismo canal que usa Devin Desktop.
 *
 * Secuencia por llamada:
 *   initialize → authenticate (windsurf-api-key) → session/new
 *   → session/set_config_option (mode/model) → session/prompt
 *   → acumular session/update hasta que el prompt responde.
 */

export function loadCredentials(credentialsPath = config.devinCredentialsPath) {
  if (!existsSync(credentialsPath)) {
    throw new Error(
      `No se encontró ${credentialsPath}. Autenticá Devin Desktop o ejecutá \`devin auth login\`.`,
    );
  }
  const toml = readFileSync(credentialsPath, 'utf8');
  const get = (k) => toml.match(new RegExp(`${k}\\s*=\\s*"([^"]+)"`))?.[1];
  const apiKey = get('windsurf_api_key');
  const apiServerUrl = get('api_server_url');
  if (!apiKey || !apiServerUrl) {
    throw new Error(
      `${credentialsPath} no contiene windsurf_api_key/api_server_url. Re-autenticá con \`devin auth login\`.`,
    );
  }
  return { apiKey, apiServerUrl };
}

class AcpClient {
  #proc;
  #buffer = '';
  #pending = new Map();
  #nextId = 1;
  #log;
  onUpdate;

  constructor(cwd, logPath) {
    this.#proc = spawn(config.devinBin, ['acp'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#log = logPath ? createWriteStream(logPath, { flags: 'a' }) : null;
    // El stream puede fallar (ENOSPC, etc.) — el log nunca debe tumbar la sesión.
    this.#log?.on('error', () => {});
    this.#proc.stdout.on('data', (chunk) => this.#onData(chunk));
    this.#proc.stderr.on('data', (chunk) => this.#writeLog(`[stderr] ${chunk}`));
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
}

async function startSession({ cwd, logPath, model, mode }) {
  const client = new AcpClient(cwd, logPath);
  // Sin fs/terminal capabilities: el agente usa sus tools nativos
  // (local_exec/local_write/...) que corren server-side en `cwd`.
  // Si las anunciamos, el agente delega cada fs op al cliente y se
  // bloquearía esperando respuestas que nunca llegan.
  await client.call('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'metabuilder-orchestrator', version: '0.1.0' },
  });
  const { apiKey, apiServerUrl } = loadCredentials();
  await client.call('authenticate', {
    methodId: 'windsurf-api-key',
    _meta: { api_key: apiKey, api_server_url: apiServerUrl },
  });
  const session = await client.call('session/new', { cwd, mcpServers: [] });
  await client.call('session/set_config_option', {
    sessionId: session.sessionId,
    configId: 'mode',
    value: mode,
  });
  if (model) {
    await client.call('session/set_config_option', {
      sessionId: session.sessionId,
      configId: 'model',
      value: model,
    });
  }
  return { client, sessionId: session.sessionId };
}

/**
 * Ejecuta un prompt contra Devin en `cwd` y espera el fin del turno.
 * Devuelve { ok, text, stopReason, sessionId, error? }.
 */
export async function runDevinPrompt({
  prompt,
  cwd,
  timeoutMs = config.devinTimeoutMs,
  model = config.devinModel,
  mode = config.devinMode,
  logPath,
  onText,
  onActivity,
}) {
  let client;
  const textParts = [];
  try {
    const started = await startSession({ cwd, logPath, model, mode });
    client = started.client;
    const sessionId = started.sessionId;

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
    };
  } catch (err) {
    return {
      ok: false,
      text: textParts.join(''),
      stopReason: null,
      sessionId: null,
      error: String(err?.message ?? err),
    };
  } finally {
    client?.close();
  }
}

/**
 * Probe de autenticación para preflight: initialize + authenticate.
 */
export async function checkDevinAuth(timeoutMs = 30_000) {
  let client;
  try {
    client = new AcpClient(config.rootDir, null);
    await withTimeout(
      (async () => {
        await client.call('initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'metabuilder-orchestrator', version: '0.1.0' },
        });
        const { apiKey, apiServerUrl } = loadCredentials();
        await client.call('authenticate', {
          methodId: 'windsurf-api-key',
          _meta: { api_key: apiKey, api_server_url: apiServerUrl },
        });
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
