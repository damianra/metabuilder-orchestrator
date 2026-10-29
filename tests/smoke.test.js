import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isEmbeddedDb, smokeApp } from '../src/tools/smoke.js';
import { smokeNode } from '../src/agents/smoke.js';
import { getStack } from '../src/stacks/index.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'mb-smoke-'));
const servers = [];

// Puerto libre: bind en 0, leer el asignado, cerrar.
const freePort = () =>
  new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => res(port));
    });
  });

// spawnFn fake: levanta un http server real en `port` con el handler
// dado y devuelve un child-process simulado. `die` → el proc muere al
// instante (boot failure).
const fakeSpawn = (handler, { die = false, port } = {}) => () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  if (die) {
    child.pid = null;
    setImmediate(() => child.emit('close', 127));
    return child;
  }
  const server = createServer(handler);
  server.listen(port, '127.0.0.1');
  servers.push(server);
  child.pid = 4242;
  child._server = server;
  return child;
};

// Router files de ambos estilos: app/routers/items.py (fastapi-routes
// → /api/items) y server/routes/items.js (express-routes →
// /api/items/list) — cada scanner solo lee el suyo.
const apiDir = (withDist = false) => {
  const d = tmp();
  mkdirSync(join(d, 'app', 'routers'), { recursive: true });
  writeFileSync(
    join(d, 'app', 'routers', 'items.py'),
    "router = APIRouter()\n@router.get('')\ndef l(): ...\n@router.post('')\ndef c(): ...\n",
  );
  mkdirSync(join(d, 'server', 'routes'), { recursive: true });
  writeFileSync(
    join(d, 'server', 'routes', 'items.js'),
    "import { Router } from 'express';\nconst router = Router();\nrouter.get('/list', (req, res) => res.json([]));\nexport default router;\n",
  );
  if (withDist) {
    mkdirSync(join(d, 'dist'), { recursive: true });
    writeFileSync(join(d, 'dist', 'index.html'), '<html/>');
  }
  return d;
};

const contract = (overrides = {}) => (req, res) => {
  const table = {
    '/api/health': 200,
    '/api/items': 200,
    '/api/items/list': 200,
    '/': 200,
    '/smoke/deep-route': 200,
    ...overrides,
  };
  const status = req.url.startsWith('/api') ? (table[req.url] ?? 404) : (table[req.url] ?? 200);
  res.writeHead(status).end('{}');
};

const stackWith = (base, port) => ({
  ...base,
  toolchain: { ...base.toolchain, devPort: port },
});

const killNoop = () => {};
const cleanup = () => servers.splice(0).forEach((s) => s.close());

describe('isEmbeddedDb', () => {
  it('express-sqlite embebida; fastapi según DATABASE_URL; externas no', () => {
    expect(isEmbeddedDb(tmp(), getStack('express-sqlite'))).toBe(true);
    const d = tmp();
    expect(isEmbeddedDb(d, getStack('fastapi'))).toBe(true); // sin .env → sqlite default
    writeFileSync(join(d, '.env'), 'DATABASE_URL=postgresql+psycopg2://u:p@h/db\n');
    expect(isEmbeddedDb(d, getStack('fastapi'))).toBe(false);
    expect(isEmbeddedDb(tmp(), getStack('express-postgres'))).toBe(false);
    expect(isEmbeddedDb(tmp(), getStack('nest-typeorm'))).toBe(false);
  });
});

describe('smokeApp', () => {
  it('contrato completo OK con DB embebida + SPA', async () => {
    const port = await freePort();
    const dir = apiDir(true);
    const stack = stackWith(getStack('fastapi'), port);
    const r = await smokeApp(dir, stack, {
      spawnFn: fakeSpawn(contract(), { port }),
      killGroup: killNoop,
    });
    cleanup();
    expect(r.ok).toBe(true);
    expect(r.strict).toBe(true);
    const names = Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
    expect(names['GET /api/health']).toBe('pass');
    expect(names['GET /api/items']).toBe('pass');
    expect(names['GET /api/* → 404 JSON']).toBe('pass');
    expect(names['SPA GET /']).toBe('pass');
    expect(names['SPA fallback']).toBe('pass');
  });

  it('health != 200 → fail strict', async () => {
    const port = await freePort();
    const dir = apiDir();
    const stack = stackWith(getStack('express-sqlite'), port);
    const r = await smokeApp(dir, stack, {
      spawnFn: fakeSpawn(contract({ '/api/health': 500 }), { port }),
      killGroup: killNoop,
    });
    cleanup();
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'GET /api/health').status).toBe('fail');
  });

  it('endpoint GET 404 → fail de wiring siempre', async () => {
    const port = await freePort();
    const dir = apiDir();
    const stack = stackWith(getStack('express-sqlite'), port);
    const r = await smokeApp(dir, stack, {
      spawnFn: fakeSpawn((req, res) => {
        if (req.url === '/api/health') res.writeHead(200).end();
        else res.writeHead(404).end();
      }, { port }),
      killGroup: killNoop,
    });
    cleanup();
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'GET /api/items/list').status).toBe('fail');
  });

  it('DB externa: endpoint 5xx → warn (no fail) y ok:true', async () => {
    const port = await freePort();
    const dir = apiDir();
    const stack = stackWith(getStack('express-postgres'), port);
    const r = await smokeApp(dir, stack, {
      spawnFn: fakeSpawn(contract({ '/api/items/list': 500 }), { port }),
      killGroup: killNoop,
    });
    cleanup();
    expect(r.strict).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'GET /api/items/list').status).toBe('warn');
  });

  it('DB externa que no levanta (sin credenciales) → warn + ok', async () => {
    const port = await freePort();
    const dir = apiDir();
    const stack = stackWith(getStack('express-postgres'), port);
    const r = await smokeApp(dir, stack, {
      spawnFn: fakeSpawn(null, { die: true }),
      killGroup: killNoop,
      timeoutMs: 800,
      sleepFn: async () => {},
    });
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'boot').status).toBe('warn');
  });

  it('DB embebida que no levanta → fail de boot', async () => {
    const port = await freePort();
    const dir = apiDir();
    const stack = stackWith(getStack('express-sqlite'), port);
    const r = await smokeApp(dir, stack, {
      spawnFn: fakeSpawn(null, { die: true }),
      killGroup: killNoop,
      timeoutMs: 800,
      sleepFn: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'boot').status).toBe('fail');
  });

  it('puerto ocupado por otro proceso → skip seguro', async () => {
    const port = await freePort();
    const foreign = createServer((req, res) => res.writeHead(200).end()).listen(port, '127.0.0.1');
    await new Promise((r) => foreign.once('listening', r));
    const dir = apiDir();
    const stack = stackWith(getStack('express-sqlite'), port);
    const r = await smokeApp(dir, stack, { spawnFn: fakeSpawn(contract(), { port }), killGroup: killNoop });
    foreign.close();
    expect(r.ok).toBe(true);
    expect(r.skipped).toContain('ocupado');
  });

  it('kind dev (frontend-only): GET / 200 strict', async () => {
    const port = await freePort();
    const stack = stackWith(getStack('vite-react'), port);
    const ok = await smokeApp(tmp(), stack, {
      kind: 'dev',
      spawnFn: fakeSpawn((req, res) => res.writeHead(200).end(), { port }),
      killGroup: killNoop,
    });
    cleanup();
    expect(ok.ok).toBe(true);

    const port2 = await freePort();
    const bad = await smokeApp(tmp(), stackWith(getStack('vite-react'), port2), {
      kind: 'dev',
      spawnFn: fakeSpawn((req, res) => res.writeHead(500).end(), { port: port2 }),
      killGroup: killNoop,
    });
    cleanup();
    expect(bad.ok).toBe(false);
    expect(bad.checks[0].status).toBe('fail');
  });
});

describe('smokeNode', () => {
  const state = {
    smokeEnabled: true,
    plan: { scope: 'backend', stacks: { backend: 'express-sqlite' } },
    scope: 'backend',
    projectDir: '/tmp/x',
    status: 'building',
  };

  it('skip con --no-smoke o plan.smoke=false', async () => {
    const r1 = await smokeNode({ ...state, smokeEnabled: false });
    expect(r1.history[0].msg).toContain('skip');
    const r2 = await smokeNode({ ...state, plan: { ...state.plan, smoke: false } });
    expect(r2.history[0].msg).toContain('skip');
  });

  it('mapea checks del tool: fail → status failed, warn → ok', async () => {
    const failing = async () => ({
      ok: false,
      checks: [{ name: 'GET /api/health', status: 'fail', detail: '500' }],
    });
    const r = await smokeNode(state, { smokeApp: failing });
    expect(r.status).toBe('failed');
    expect(r.lastError).toContain('smoke');
    expect(r.smokeResult.checks[0].stack).toBe('express-sqlite');

    const okNode = await smokeNode(state, {
      smokeApp: async () => ({ ok: true, checks: [{ name: 'boot', status: 'warn', detail: 'x' }] }),
    });
    expect(okNode.status).toBeUndefined();
    expect(okNode.lastError).toBeNull();
    expect(okNode.smokeResult.warns).toBe(1);
  });
});
