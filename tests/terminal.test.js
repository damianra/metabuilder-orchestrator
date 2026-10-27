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
  let dir, server, port, lastPty, released, term;
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
    term = attachTerminal(server, {
      appsDir: dir,
      acquireSlot: acquireFake,
      spawnPty: spawnFake,
      idleKillMs: 60_000,
      // En tests los bins reales apuntan al stub (DEVIN_BIN/OPENCODE_BIN)
      // — engineFor devuelve descriptors con el bin literal del id para
      // que las aserciones sobre bin sean legibles.
      engineFor: (id) =>
        ['devin', 'opencode'].includes(id)
          ? { id, label: id === 'opencode' ? 'OpenCode' : 'Devin', bin: id, tuiArgs: [] }
          : null,
      defaultEngineId: () => 'devin',
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

  it('?engine=opencode spawnea el binario de ese engine', async () => {
    const ws = await connect(wsUrl(port, 'demo-app', '?engine=opencode'));
    await nextMsg(ws); // status slot
    const ready = await nextMsg(ws);
    expect(ready.msg).toMatch(/OpenCode/);
    expect(lastPty.bin).toBe('opencode');
    ws.close();
  });

  it('engine desconocido → error al cliente, sin pty', async () => {
    const ws = await connect(wsUrl(port, 'demo-app', '?engine=nope'));
    const m = await nextMsg(ws);
    expect(m.t).toBe('error');
    expect(m.msg).toMatch(/engine desconocido/);
    expect(lastPty).toBeNull();
    ws.close();
  });

  it('los dos engines conviven por slug (sesiones slug:engine)', async () => {
    const ws1 = await connect(wsUrl(port, 'demo-app', '?engine=devin'));
    await nextMsg(ws1);
    await nextMsg(ws1);
    const ptyDevin = lastPty;

    const ws2 = await connect(wsUrl(port, 'demo-app', '?engine=opencode'));
    await nextMsg(ws2);
    await nextMsg(ws2);
    expect(lastPty.bin).toBe('opencode');
    expect(lastPty).not.toBe(ptyDevin);
    expect(ptyDevin.killed).toBe(false); // la sesión devin sigue viva
    ws1.close();
    ws2.close();
  });

  it('killBySlug mata todas las sesiones del slug (cualquier engine)', async () => {
    const ws1 = await connect(wsUrl(port, 'demo-app', '?engine=devin'));
    await nextMsg(ws1);
    await nextMsg(ws1);
    const ws2 = await connect(wsUrl(port, 'demo-app', '?engine=opencode'));
    await nextMsg(ws2);
    await nextMsg(ws2);
    expect(term.sessions.size).toBe(2);
    term.killBySlug('demo-app', 'test');
    expect(term.sessions.size).toBe(0);
    ws1.close();
    ws2.close();
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

  it('cliente que se desconecta esperando el slot no deja pty huérfano', async () => {
    // slot que se resuelve a mano — simula espera larga del semáforo
    let resolveSlot;
    const slotPromise = new Promise((r) => (resolveSlot = r));
    const app2 = express();
    const srv2 = createServer(app2);
    attachTerminal(srv2, {
      appsDir: dir,
      acquireSlot: () => slotPromise,
      spawnPty: spawnFake,
      idleKillMs: 60_000,
    });
    await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
    const p2 = srv2.address().port;

    const ws = await connect(wsUrl(p2, 'demo-app'));
    expect((await nextMsg(ws)).msg).toMatch(/slot/i);
    ws.close(); // se fue antes de conseguir slot
    await new Promise((r) => setTimeout(r, 30));
    let released2 = false;
    resolveSlot(() => (released2 = true)); // el semáforo cede tarde
    await new Promise((r) => setTimeout(r, 30));
    expect(lastPty).toBeNull(); // no se spawnó nada
    expect(released2).toBe(true); // y el slot se soltó
    srv2.close();
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
