import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Solo asserts de lectura sobre DESIGN_DIR real (apunta a
// <repo>/design-work — create/discard podrían borrar una sesión real
// en curso). Los casos que necesitan archivos usan el param `dir` con
// un tmpdir propio, y el sweep recibe `stop`/`lastActivity` inyectados
// para no frenar un dev run real.
import {
  apiContextBlock,
  attachFrontendFiles,
  attachPlanUpdate,
  DESIGN_DIR,
  designIdleSweep,
  designStatus,
} from '../src/design/session.js';

describe('design session', () => {
  it('designStatus responde el contrato exists/messages', () => {
    const s = designStatus();
    expect(typeof s.exists).toBe('boolean');
    expect(Array.isArray(s.messages)).toBe(true);
    if (!s.exists) expect(s.messages).toEqual([]);
  });

  it('DESIGN_DIR vive fuera de generated-apps (no aparece como proyecto)', () => {
    expect(DESIGN_DIR.endsWith('design-work')).toBe(true);
    expect(DESIGN_DIR).not.toContain('generated-apps');
  });

  it('urls solo se reportan con el dev run vivo (dev-run.json)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-design-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{}');
      // El log es append-only: la URL queda aunque el run haya parado.
      writeFileSync(join(dir, 'dev-run.log'), 'Local: http://localhost:5173/\n');
      writeFileSync(
        join(dir, 'dev-run.json'),
        JSON.stringify({ status: 'stopped', procs: [{ pid: process.pid, alive: false }] }),
      );
      const stopped = designStatus(dir);
      expect(stopped.devRunning).toBe(false);
      expect(stopped.urls).toEqual([]);
      writeFileSync(
        join(dir, 'dev-run.json'),
        JSON.stringify({ status: 'running', procs: [{ pid: process.pid, alive: true }] }),
      );
      const running = designStatus(dir);
      expect(running.devRunning).toBe(true);
      expect(running.urls).toEqual(['http://localhost:5173']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('designIdleSweep frena el dev run solo cuando la actividad venció', () => {
    const stop = vi.fn(() => ({ stopped: true }));
    const T = 1_000_000;
    // actividad reciente → no hay park ni llamada a stop
    expect(
      designIdleSweep({ now: T, idleMs: 60_000, lastActivity: T - 10_000, stop }),
    ).toEqual({ parked: false });
    expect(stop).not.toHaveBeenCalled();
    // actividad vencida → park
    expect(
      designIdleSweep({ now: T, idleMs: 60_000, lastActivity: T - 61_000, stop }),
    ).toEqual({ parked: true });
    expect(stop).toHaveBeenCalledTimes(1);
    // stop sin nada vivo (stopped:false) → no cuenta como park
    expect(
      designIdleSweep({
        now: T,
        idleMs: 60_000,
        lastActivity: T - 61_000,
        stop: () => ({ stopped: false }),
      }),
    ).toEqual({ parked: false });
    // idleMs 0 = feature apagada
    expect(
      designIdleSweep({ now: T, idleMs: 0, lastActivity: 0, stop }),
    ).toEqual({ parked: false });
  });
});

describe('attach: backend → diseño (v10)', () => {
  it('apiContextBlock lista los endpoints reales del backend', () => {
    const base = mkdtempSync(join(tmpdir(), 'mb-attach-'));
    const dir = join(base, 'mi-api');
    mkdirSync(join(dir, 'server', 'routes'), { recursive: true });
    writeFileSync(
      join(dir, 'server', 'routes', 'products.js'),
      "router.get('/', () => {});\nrouter.post('/nuevo', () => {});\n",
    );
    const block = apiContextBlock('mi-api', base);
    expect(block).toContain('GET /api/products/');
    expect(block).toContain('POST /api/products/nuevo');
    expect(block).toContain('"mi-api"');
    expect(apiContextBlock(null, base)).toBe('');
    expect(apiContextBlock('sin-routes', base)).toBe('');
    rmSync(base, { recursive: true, force: true });
  });

  it('attachFrontendFiles copia el front y mergea package.json por clave', () => {
    const base = mkdtempSync(join(tmpdir(), 'mb-attach-'));
    const src = join(base, 'design');
    const dest = join(base, 'back');
    mkdirSync(join(src, 'src'), { recursive: true });
    writeFileSync(
      join(src, 'package.json'),
      JSON.stringify({
        name: 'd',
        scripts: { dev: 'vite', build: 'vite build', 'test:e2e': 'playwright test' },
        devDependencies: { vite: '^7' },
      }),
    );
    writeFileSync(join(src, 'index.html'), '<html>');
    writeFileSync(join(src, '.gitignore'), 'dist/\n');
    writeFileSync(join(src, 'src', 'App.jsx'), 'export default () => null;');
    mkdirSync(join(dest, 'server'), { recursive: true });
    writeFileSync(
      join(dest, 'package.json'),
      JSON.stringify({
        name: 'b',
        scripts: { api: 'node server/index.js', test: 'vitest run' },
        dependencies: { express: '^5' },
      }),
    );
    writeFileSync(join(dest, '.gitignore'), 'server/uploads/\n');
    writeFileSync(join(dest, 'server', 'app.js'), '// api');

    attachFrontendFiles(src, dest);

    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
    // backend gana en clashes; el front agrega dev/build/test:e2e
    expect(pkg.scripts).toMatchObject({
      api: 'node server/index.js',
      test: 'vitest run',
      dev: 'vite',
      build: 'vite build',
      'test:e2e': 'playwright test',
    });
    expect(pkg.dependencies.express).toBe('^5');
    expect(pkg.devDependencies.vite).toBe('^7');
    expect(existsSync(join(dest, 'index.html'))).toBe(true);
    expect(existsSync(join(dest, 'src', 'App.jsx'))).toBe(true);
    expect(readFileSync(join(dest, 'server', 'app.js'), 'utf8')).toBe('// api');
    const gi = readFileSync(join(dest, '.gitignore'), 'utf8');
    expect(gi).toContain('server/uploads/');
    expect(gi).toContain('dist/');
    rmSync(base, { recursive: true, force: true });
  });

  it('attachFrontendFiles sin package.json en el backend (python) escribe el del front', () => {
    const base = mkdtempSync(join(tmpdir(), 'mb-attach-'));
    const src = join(base, 'design');
    const dest = join(base, 'back');
    mkdirSync(join(src, 'src'), { recursive: true });
    writeFileSync(
      join(src, 'package.json'),
      JSON.stringify({ name: 'd', scripts: { dev: 'vite' }, devDependencies: { vite: '^7' } }),
    );
    writeFileSync(join(src, 'index.html'), '<html>');
    mkdirSync(join(dest, 'app'), { recursive: true });
    writeFileSync(join(dest, 'requirements.txt'), 'fastapi>=0.115\n');

    attachFrontendFiles(src, dest);

    // Sin merge posible: el package.json del front pasa entero — el
    // backend python no tenía deps/scripts que preservar.
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({ name: 'd', scripts: { dev: 'vite' } });
    expect(existsSync(join(dest, 'index.html'))).toBe(true);
    expect(readFileSync(join(dest, 'requirements.txt'), 'utf8')).toContain('fastapi');
    rmSync(base, { recursive: true, force: true });
  });

  it('attachPlanUpdate marca fullstack + step done + compliance base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-attach-'));
    writeFileSync(
      join(dir, 'plan.json'),
      JSON.stringify({
        projectName: 'b',
        scope: 'backend',
        steps: [{ id: 1, type: 'backend', status: 'done' }],
      }),
    );
    attachPlanUpdate(dir, 'vite-react', '2026-01-01T00:00:00Z');
    const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
    expect(plan.scope).toBe('fullstack');
    expect(plan.stacks.frontend).toBe('vite-react');
    expect(plan.compliance).toEqual(['privacidad', 'notfound']);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1]).toMatchObject({ id: 2, type: 'frontend', status: 'done' });
    expect(plan.steps[1].description).toContain('Vite');
    // Plan legacy sin timings → el attach lo completa (chip ⏱).
    expect(plan.timings).toMatchObject({ startedAt: '2026-01-01T00:00:00Z' });
    expect(plan.timings.finishedAt).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('initGitRepo crea .git con initial commit idempotente', async () => {
    const { initGitRepo } = await import('../src/agents/common.js');
    const dir = mkdtempSync(join(tmpdir(), 'mb-git-'));
    writeFileSync(join(dir, 'x.txt'), 'hola');
    const r = await initGitRepo(dir);
    expect(r.ok).toBe(true);
    expect(existsSync(join(dir, '.git'))).toBe(true);
    // Segunda corrida sin cambios → ok, sin commit nuevo.
    const r2 = await initGitRepo(dir);
    expect(r2.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

