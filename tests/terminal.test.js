import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { WebSocket } from 'ws';
import { attachTerminal } from '../src/dashboard/terminal.js';

// PTY fake: captura write/resize/kill y emite data/exit on-demand.
const fakePty = () => {
  const h = { data: [], exit: [] };
  return {
    written: [],
    resized: [],
    killed: false,
    cols: 80,
    rows: 24,
    write(d) {
      this.written.push(d);
    },
    resize(c, r) {
      this.resized.push([c, r]);
      this.cols = c;
      this.rows = r;
    },
    kill() {
      this.killed = true;
    },
    onData(fn) {
      h.data.push(fn);
    },
    onExit(fn) {
      h.exit.push(fn);
    },
    emitData: (d) => h.data.forEach((f) => f(d)),
    emitExit: (code) => h.exit.forEach((f) => f({ exitCode: code })),
  };
};

const wsUrl = (port, slug, q = '') =>
  `ws://127.0.0.1:${port}/api/projects/${slug}/terminal${q}`;

// Bufferiza desde el 'open': el server manda status apenas termina el
// handshake — con `once('message')` ad-hoc se pierden mensajes que
// llegan antes de registrar el listener.
const connect = (url, headers) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(url, { headers });
    const queue = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (waiters.length) waiters.shift()(m);
      else queue.push(m);
    });
    ws.next = () =>
      queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r));
    ws.once('open', () => res(ws));
    ws.once('error', rej);
    ws.once('unexpected-response', (req, r) =>
      rej(new Error(`unexpected-response ${r.statusCode}`)),
    );
  });

const nextMsg = (ws) => ws.next();

describe('terminal Devin (WS + pty)', () => {
  let dir, server, port, lastPty, released;
  const spawnFake = async () => (bin, args, opts) => {
    lastPty = fakePty();
    lastPty.bin = bin;
    lastPty.cwd = opts.cwd;
    lastPty.cols = opts.cols;
    lastPty.rows = opts.rows;
    return lastPty;
  };
  const acquireFake = async () => () => {
    released = true;
  };

  const seedApp = (slug = 'demo-app') => {
    const d = join(dir, slug);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'plan.json'), '{}');
    return d;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mb-term-'));
    released = false;
    lastPty = null;
    seedApp();
    const app = express();
    app.get('/api/health', (req, res) => res.json({ ok: true }));
    server = createServer(app);
    attachTerminal(server, {
      appsDir: dir,
      acquireSlot: acquireFake,
      spawnPty: spawnFake,
      idleKillMs: 60_000,
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  afterEach(async () => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rechaza slugs inválidos o proyectos inexistentes', async () => {
    await expect(connect(wsUrl(port, 'no-existe'))).rejects.toThrow();
    await expect(connect(wsUrl(port, '..'))).rejects.toThrow();
    // dir existe pero sin plan.json → no es proyecto
    mkdirSync(join(dir, 'sin-plan'), { recursive: true });
    await expect(connect(wsUrl(port, 'sin-plan'))).rejects.toThrow();
  });

  it('rechaza Origin no-localhost (CSWSH)', async () => {
    await expect(
      connect(wsUrl(port, 'demo-app'), { origin: 'https://evil.example' }),
    ).rejects.toThrow();
    // y acepta localhost
    const ws = await connect(wsUrl(port, 'demo-app'), {
      origin: 'http://127.0.0.1:4173',
    });
    ws.close();
  });

  it('spawnea devin en el dir del proyecto y puentea input/output', async () => {
    const ws = await connect(wsUrl(port, 'demo-app'));
    expect((await nextMsg(ws)).msg).toMatch(/slot/i); // 'esperando slot…'
    expect((await nextMsg(ws)).msg).toMatch(/lista/i); // 'sesión Devin lista'
    expect(lastPty.bin).toBe('devin');
    expect(lastPty.cwd).toBe(join(dir, 'demo-app'));

    ws.send(JSON.stringify({ t: 'in', d: 'hola\n' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(lastPty.written).toContain('hola\n');

    lastPty.emitData('respuesta del agente');
    const m = await nextMsg(ws);
    expect(m).toEqual({ t: 'out', d: 'respuesta del agente' });
    ws.close();
  });

  it('aplica resize al pty', async () => {
    const ws = await connect(wsUrl(port, 'demo-app', '?cols=120&rows=40'));
    await nextMsg(ws); // status slot
    await nextMsg(ws); // status lista
    expect(lastPty.cols).toBe(120);
    ws.send(JSON.stringify({ t: 'resize', cols: 999, rows: 10 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(lastPty.resized.at(-1)).toEqual([300, 10]); // clamp
    ws.close();
  });

  it('un segundo cliente se adjunta al mismo pty con scrollback', async () => {
    const ws1 = await connect(wsUrl(port, 'demo-app'));
    await nextMsg(ws1);
    await nextMsg(ws1);
    lastPty.emitData('output previo');
    await nextMsg(ws1);

    const ws2 = await connect(wsUrl(port, 'demo-app'));
    const m = await nextMsg(ws2);
    expect(m).toEqual({ t: 'out', d: 'output previo' }); // replay
    expect(lastPty.killed).toBe(false);
    ws1.close();
    ws2.close();
  });

  it('close explícito mata el pty y libera el slot', async () => {
    const ws = await connect(wsUrl(port, 'demo-app'));
    await nextMsg(ws);
    await nextMsg(ws);
    ws.send(JSON.stringify({ t: 'close' }));
    const m = await nextMsg(ws);
    expect(m.t).toBe('exit');
    expect(lastPty.killed).toBe(true);
    expect(released).toBe(true);
    ws.close();
  });

  it('exit del pty notifica y libera', async () => {
    const ws = await connect(wsUrl(port, 'demo-app'));
    await nextMsg(ws);
    await nextMsg(ws);
    lastPty.emitExit(0);
    const m = await nextMsg(ws);
    expect(m).toEqual({ t: 'exit', code: 0 });
    expect(released).toBe(true);
    ws.close();
  });

  it('node-pty real funciona en este entorno (echo)', async (ctx) => {
    let spawn;
    try {
      spawn = (await import('node-pty')).spawn;
    } catch {
      return ctx.skip();
    }
    const p = spawn('echo', ['ok-pty'], { name: 'xterm' });
    const out = await new Promise((res, rej) => {
      let buf = '';
      p.onData((d) => {
        buf += d;
        if (buf.includes('ok-pty')) res(buf);
      });
      setTimeout(() => rej(new Error('timeout pty')), 5000);
    });
    expect(out).toContain('ok-pty');
    p.kill();
  });
});
