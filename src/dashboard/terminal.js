// Terminal Devin embebida — WebSocket /api/projects/:slug/terminal que
// spawnea `devin` (CLI interactivo) via PTY con cwd en la app generada.
// La sesión adquiere un slot del semáforo Devin (devin-lock) como
// cualquier runDevinPrompt: si una generación está corriendo, la
// terminal espera (la UI muestra "esperando slot"). Una sesión por
// slug — clientes extra se adjuntan al mismo pty (mirror + scrollback
// replay). Cuando el último cliente se va, el pty sigue vivo por
// IDLE_KILL_MS por si fue una navegación; el botón "Cerrar" mata
// inmediato. Solo dirs dentro de appsDir; Origin non-localhost se
// rechaza (defensa CSWSH — la API bindea 127.0.0.1 pero el browser de
// otra pestaña podría conectar).

import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
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
    devinBin = 'devin',
    idleKillMs = IDLE_KILL_MS,
  } = {},
) {
  const sessions = new Map(); // slug → { pty, clients, release, scroll, idleTimer }
  const wss = new WebSocketServer({ noServer: true });

  const killSession = (slug, session, why) => {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    try {
      session.pty?.kill();
    } catch {
      /* ya murió */
    }
    session.release?.();
    sessions.delete(slug);
    for (const c of session.clients) send(c, { t: 'exit', why });
  };

  const scheduleIdleKill = (slug, session) => {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(
      () => killSession(slug, session, 'idle'),
      idleKillMs,
    );
  };

  const startSession = async (slug, dir, cols, rows, ws) => {
    const session = {
      pty: null,
      clients: new Set(),
      release: null,
      scroll: '',
      idleTimer: null,
    };
    sessions.set(slug, session);
    send(ws, { t: 'status', msg: 'esperando slot Devin…' });
    session.release = await acquireSlot({
      onWait: () =>
        send(ws, {
          t: 'status',
          msg: 'slot ocupado (hay una generación en curso) — esperando…',
        }),
    });
    try {
      const spawn = await spawnPty();
      session.pty = spawn(devinBin, [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: dir,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    } catch (err) {
      for (const c of session.clients)
        send(c, { t: 'error', msg: `no se pudo abrir la terminal: ${err.message}` });
      killSession(slug, session, 'spawn-failed');
      return;
    }
    session.pty.onData((d) => {
      session.scroll = (session.scroll + d).slice(-SCROLLBACK_MAX);
      for (const c of session.clients) send(c, { t: 'out', d });
    });
    session.pty.onExit(({ exitCode }) => {
      for (const c of session.clients) send(c, { t: 'exit', code: exitCode });
      killSession(slug, session, 'exit');
    });
    for (const c of session.clients)
      send(c, { t: 'status', msg: 'sesión Devin lista' });
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
    if (origin && !LOCAL_HOST.test(new URL(origin).host)) return reject();

    wss.handleUpgrade(req, socket, head, (ws) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const cols = Math.min(Number(q.get('cols')) || 80, 300);
      const rows = Math.min(Number(q.get('rows')) || 24, 100);

      let session = sessions.get(slug);
      if (session?.pty) {
        // reattach: mirror + scrollback
        if (session.idleTimer) clearTimeout(session.idleTimer);
        if (session.scroll) send(ws, { t: 'out', d: session.scroll });
      } else if (!session) {
        startSession(slug, dir, cols, rows, ws);
        session = sessions.get(slug);
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
        } else if (msg.t === 'close') killSession(slug, session, 'cerrada');
      });
      ws.on('close', () => {
        session.clients.delete(ws);
        if (!session.clients.size && sessions.get(slug) === session)
          scheduleIdleKill(slug, session);
      });
      ws.on('error', () => ws.close());
    });
  });

  return { sessions, wss };
}
