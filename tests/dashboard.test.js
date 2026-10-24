import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../src/dashboard/server.js';

let base, appsDir, runsDir, server, url;

const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data));

const seedApp = (slug, { status = 'done', steps = 2 } = {}) => {
  const dir = join(appsDir, slug);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'plan.json'), {
    projectName: slug,
    scope: 'fullstack',
    appType: 'custom',
    arch: 'flat',
    validated: true,
    steps: Array.from({ length: steps }, (_, i) => ({
      id: i + 1,
      type: 'frontend',
      status: 'done',
      verify: 'npm run build',
    })),
  });
  writeJson(join(dir, 'status.json'), { status, lastError: null, ts: '2026-01-01T00:00:00Z' });
  return dir;
};

const api = async (path, opts) => {
  const res = await fetch(`${url}${path}`, opts);
  return { status: res.status, body: await res.json() };
};
const post = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'mb-dash-'));
  appsDir = join(base, 'generated-apps');
  runsDir = join(base, 'runs');
  mkdirSync(appsDir, { recursive: true });
  const app = createDashboardApp({
    appsDir,
    runsDir,
    baseDir: base,
    dockerProbe: async () => false,
    startBuild: () => ({ status: 'running', tag: 'fake:local' }),
  });
  await new Promise((resolveListen) => {
    server = app.listen(0, '127.0.0.1', resolveListen);
  });
  url = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(base, { recursive: true, force: true });
});

describe('GET /api/projects', () => {
  it('lista generated-apps con resumen de plan/status', async () => {
    seedApp('app-uno');
    seedApp('app-dos', { status: 'failed', steps: 3 });
    const { status, body } = await api('/api/projects');
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    const uno = body.find((p) => p.slug === 'app-uno');
    expect(uno).toMatchObject({
      name: 'app-uno',
      scope: 'fullstack',
      arch: 'flat',
      status: 'done',
      steps: { total: 2, done: 2, failed: 0 },
      hasDockerfile: false,
    });
  });
});

describe('GET /api/projects/:slug', () => {
  it('devuelve detalle con pasos y dockerBuild', async () => {
    seedApp('app-uno');
    const { status, body } = await api('/api/projects/app-uno');
    expect(status).toBe(200);
    expect(body.planSteps).toHaveLength(2);
    expect(body.dockerBuild).toBeNull();
  });

  it('404 en slug inexistente y en path traversal', async () => {
    expect((await api('/api/projects/nope')).status).toBe(404);
    expect((await api('/api/projects/..%2F..%2Fetc')).status).toBe(404);
  });
});

describe('POST /api/runs', () => {
  it('encola un job con args del CLI y --yes --no-push por default', async () => {
    const { status, body } = await post('/api/runs', {
      idea: 'blog de recetas',
      scope: 'frontend',
      arch: 'mvc',
      name: 'mi-blog',
    });
    expect(status).toBe(201);
    expect(body.job.args).toEqual([
      '--idea', 'blog de recetas', '--yes',
      '--scope', 'frontend',
      '--name', 'mi-blog',
      '--arch', 'mvc',
      '--no-push',
    ]);
    const jobs = JSON.parse(readFileSync(join(base, 'jobs', `${body.job.id}.json`), 'utf8'));
    expect(jobs.status).toBe('pending');
  });

  it('propaga flags de deploy y verify-docker', async () => {
    const { body } = await post('/api/runs', { idea: 'x', github: true, ghpages: true, verifyDocker: true });
    expect(body.job.args).toContain('--github');
    expect(body.job.args).toContain('--ghpages');
    expect(body.job.args).toContain('--verify-docker');
    expect(body.job.args).not.toContain('--no-push');
  });

  it('400 en idea vacía, scope/arch/name inválidos', async () => {
    expect((await post('/api/runs', {})).status).toBe(400);
    expect((await post('/api/runs', { idea: 'x', scope: 'todo' })).status).toBe(400);
    expect((await post('/api/runs', { idea: 'x', arch: 'hexagonal' })).status).toBe(400);
    expect((await post('/api/runs', { idea: 'x', name: 'Mi App!' })).status).toBe(400);
    expect((await post('/api/runs', { idea: 'x', appType: 'nest' })).status).toBe(400);
  });
});

describe('POST /api/projects/:slug/actions', () => {
  it('resume encola --resume <slug> --yes --no-push', async () => {
    seedApp('app-uno');
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'resume' });
    expect(status).toBe(201);
    expect(body.job.args).toEqual(['--resume', 'app-uno', '--yes', '--no-push']);
  });

  it('dockerize escribe Dockerfile y reporta skipped sin daemon', async () => {
    const dir = seedApp('app-uno');
    mkdirSync(join(dir, 'server'));
    writeFileSync(join(dir, 'vite.config.js'), '');
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'dockerize' });
    expect(status).toBe(200);
    expect(body.variant).toBe('fullstack');
    expect(body.build.status).toBe('skipped');
    expect(existsSync(join(dir, 'Dockerfile'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'docker-build.json'), 'utf8')).status).toBe('skipped');
  });

  it('open-repo devuelve URL https del remote; 404 sin remote', async () => {
    const dir = seedApp('app-uno');
    execSync('git init -q && git remote add origin git@github.com:user/app-uno.git', { cwd: dir });
    const ok = await post('/api/projects/app-uno/actions', { action: 'open-repo' });
    expect(ok.body.url).toBe('https://github.com/user/app-uno');

    seedApp('app-sin-remote');
    const sin = await post('/api/projects/app-sin-remote/actions', { action: 'open-repo' });
    expect(sin.status).toBe(404);
  });

  it('400 en action desconocida y 404 en proyecto inexistente', async () => {
    seedApp('app-uno');
    expect((await post('/api/projects/app-uno/actions', { action: 'borrar' })).status).toBe(400);
    expect((await post('/api/projects/nope/actions', { action: 'resume' })).status).toBe(404);
  });
});
