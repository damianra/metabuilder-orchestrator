// Terminal de agente embebida — WebSocket /api/projects/:slug/terminal
// que spawnea el TUI del engine (`devin` / `opencode`) via PTY con cwd
// en la app generada. `?engine=<id>` elige el engine; sin param cae al
// engine configurado (settings.json > AGENT_PROVIDER > 'devin').
// La sesión adquiere un slot del semáforo de agente (devin-lock) como
// cualquier runAgentPrompt: si una generación está corriendo, la
// terminal espera (la UI muestra "esperando slot"). Una sesión por
// slug:engine (los dos engines pueden convivir por slug) — clientes
// extra se adjuntan al mismo pty (mirror + scrollback replay). Cuando
// el último cliente se va, el pty sigue vivo por IDLE_KILL_MS por si
// fue una navegación; el botón "Cerrar" mata inmediato. Solo dirs
// dentro de appsDir; Origin non-localhost se rechaza (defensa CSWSH —
// la API bindea 127.0.0.1 pero el browser de otra pestaña podría
// conectar).

import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { getEngine } from '../engines/index.js';
import { readSettings } from '../tools/settings.js';
import { acquireDevinSlot } from '../tools/devin-lock.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const IDLE_KILL_MS = 5 * 60_000;
const SCROLLBACK_MAX = 200 * 1024; // bytes de output retenidos para reattach
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

// node-pty es nativo — import lazy para que la API arranque igual en
// máquinas donde no esté disponible/compilado; el error llega al
// cliente como mensaje `error` en lugar de tumbar el server.
const loadPty = async () => (await import('node-pty')).spawn;

export function attachTerminal(
  server,
  {
    appsDir = config.generatedAppsDir,
    acquireSlot = acquireDevinSlot,
    spawnPty = loadPty,
    idleKillMs = IDLE_KILL_MS,
    // Inyectables para tests — el default resuelve del registry +
    // settings.json (misma fuente que el setup gate).
    engineFor = (id) => getEngine(id),
    defaultEngineId = () =>
      readSettings(config.settingsPath).engine || config.agentProvider || 'devin',
  } = {},
) {
  const sessions = new Map(); // `${slug}:${engineId}` → { pty, clients, release, scroll, idleTimer }
  const wss = new WebSocketServer({ noServer: true });

  const killSession = (key, session, why) => {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    try {
      session.pty?.kill();
    } catch {
      /* ya murió */
    }
    session.release?.();
    sessions.delete(key);
    for (const c of session.clients) send(c, { t: 'exit', why });
  };

  const scheduleIdleKill = (key, session) => {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(
      () => killSession(key, session, 'idle'),
      idleKillMs,
    );
  };

  // Si la sesión quedó huérfana (killSession la sacó del mapa) o sin
  // clientes mientras esperábamos un await, abortar sin spawnear —
  // si no, el pty nace sin dueño y el slot del semáforo queda tomado
  // para siempre.
  const stale = (session, key) =>
    !session.clients.size || sessions.get(key) !== session;

  const startSession = async (key, slug, engine, dir, cols, rows, ws) => {
    const session = {
      pty: null,
      clients: new Set(),
      release: null,
      scroll: '',
      idleTimer: null,
      engine,
    };
    sessions.set(key, session);
    send(ws, { t: 'status', msg: 'esperando slot…' });
    try {
      session.release = await acquireSlot({
        onWait: () =>
          send(ws, {
            t: 'status',
            msg: 'slot ocupado (hay una generación en curso) — esperando…',
          }),
      });
    } catch (err) {
      for (const c of session.clients)
        send(c, { t: 'error', msg: `sin slot: ${err.message}` });
      killSession(key, session, 'slot-failed');
      return;
    }
    if (stale(session, key)) {
      session.release?.();
      sessions.delete(key);
      return;
    }
    try {
      const spawn = await spawnPty();
      if (stale(session, key)) throw new Error('sesión abandonada');
      session.pty = spawn(engine.bin, engine.tuiArgs ?? [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: dir,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    } catch (err) {
      for (const c of session.clients)
        send(c, { t: 'error', msg: `no se pudo abrir la terminal: ${err.message}` });
      killSession(key, session, 'spawn-failed');
      return;
    }
    session.pty.onData((d) => {
      session.scroll = (session.scroll + d).slice(-SCROLLBACK_MAX);
      for (const c of session.clients) send(c, { t: 'out', d });
    });
    session.pty.onExit(({ exitCode }) => {
      for (const c of session.clients) send(c, { t: 'exit', code: exitCode });
      killSession(key, session, 'exit');
    });
    for (const c of session.clients)
      send(c, { t: 'status', msg: `sesión ${engine.label} lista` });
  };

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const m = /^\/api\/projects\/([^/]+)\/terminal$/.exec(pathname);
    // Somos el único WS del server: un upgrade bajo /api/ que no
    // matchea el path de terminal no lo va a atender nadie — hay que
    // destruir el socket o el request queda colgado para siempre.
    if (!m) {
      if (pathname.startsWith('/api/')) socket.destroy();
      return;
    }
    const slug = m[1];

    const reject = () => socket.destroy();
    if (!SLUG_RE.test(slug)) return reject();
    const dir = resolve(appsDir, slug);
    // sin plan.json no es proyecto generado; resolve+sep evita escapes
    if (!dir.startsWith(resolve(appsDir) + sep) || !existsSync(join(dir, 'plan.json')))
      return reject();
    const origin = req.headers.origin;
    if (origin) {
      let host;
      try {
        host = new URL(origin).host;
      } catch {
        return reject(); // Origin malformado — tratar como no-local
      }
      if (!LOCAL_HOST.test(host)) return reject();
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const cols = Math.min(Number(q.get('cols')) || 80, 300);
      const rows = Math.min(Number(q.get('rows')) || 24, 100);

      // Engine del TUI: ?engine=<id> o el configurado. Un id desconocido
      // se reporta al cliente en vez de destruir el socket — así la UI
      // puede mostrar el motivo.
      const engineId = q.get('engine') || defaultEngineId();
      const engine = engineFor(engineId);
      if (!engine) {
        send(ws, { t: 'error', msg: `engine desconocido "${engineId}"` });
        ws.close();
        return;
      }
      const key = `${slug}:${engine.id}`;

      let session = sessions.get(key);
      if (session?.pty) {
        // reattach: mirror + scrollback
        if (session.idleTimer) clearTimeout(session.idleTimer);
        if (session.scroll) send(ws, { t: 'out', d: session.scroll });
      } else if (!session) {
        startSession(key, slug, engine, dir, cols, rows, ws);
        session = sessions.get(key);
      }
      session.clients.add(ws);
      if (session.pty && (cols !== session.pty.cols || rows !== session.pty.rows)) {
        try {
          session.pty.resize(cols, rows);
        } catch {
          /* pty saliendo */
        }
      }

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg.t === 'in' && typeof msg.d === 'string') session.pty?.write(msg.d);
        else if (msg.t === 'resize') {
          try {
            session.pty?.resize(
              Math.min(Math.max(msg.cols | 0, 20), 300),
              Math.min(Math.max(msg.rows | 0, 5), 100),
            );
          } catch {
            /* pty saliendo */
          }
        } else if (msg.t === 'close') killSession(key, session, 'cerrada');
      });
      ws.on('close', () => {
        session.clients.delete(ws);
        if (!session.clients.size && sessions.get(key) === session)
          scheduleIdleKill(key, session);
      });
      ws.on('error', () => ws.close());
    });
  });

  // Mata TODAS las sesiones de un slug (cualquier engine — p.ej. al
  // eliminar el proyecto). Los clientes reciben {t:'exit', why}.
  const killBySlug = (slug, why = 'proyecto eliminado') => {
    for (const [key, s] of [...sessions]) {
      if (key === slug || key.startsWith(`${slug}:`)) killSession(key, s, why);
    }
  };

  return { sessions, wss, killBySlug };
}
