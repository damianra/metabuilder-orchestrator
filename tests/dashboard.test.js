import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../src/dashboard/server.js';

let base, appsDir, runsDir, server, url, startTestCalls;

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
  startTestCalls = [];
  appsDir = join(base, 'generated-apps');
  runsDir = join(base, 'runs');
  mkdirSync(appsDir, { recursive: true });
  const app = createDashboardApp({
    appsDir,
    runsDir,
    baseDir: base,
    dockerProbe: async () => false,
    startBuild: () => ({ status: 'running', tag: 'fake:local' }),
    startTest: (dir, commands, label) => {
      startTestCalls.push({ dir, commands, label });
      return { status: 'running', command: label, startedAt: '2026-01-01T00:00:00Z' };
    },
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

describe('GET /api/options', () => {
  it('expone los registries para los pickers de la UI', async () => {
    const { status, body } = await api('/api/options');
    expect(status).toBe(200);
    expect(body.scopes).toEqual(['frontend', 'backend', 'fullstack']);
    expect(body.appTypes).toContain('custom');
    expect(body.archs).toContain('flat');
    expect(body.stacks.frontend).toContain('vite-react');
    expect(body.stacks.frontend).toContain('nextjs');
    expect(body.stacks.backend).toContain('express-sqlite');
  });
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

describe('POST /api/runs — stacks', () => {
  it('serializa --stack-frontend/--stack-backend en los args', async () => {
    const { status, body } = await post('/api/runs', {
      idea: 'blog con next',
      stackFrontend: 'nextjs',
      stackBackend: 'express-sqlite',
    });
    expect(status).toBe(201);
    const args = body.job.args;
    expect(args[args.indexOf('--stack-frontend') + 1]).toBe('nextjs');
    expect(args[args.indexOf('--stack-backend') + 1]).toBe('express-sqlite');
  });

  it('rechaza ids inválidos o del kind equivocado', async () => {
    expect((await post('/api/runs', { idea: 'x', stackFrontend: 'nope' })).status).toBe(400);
    // express-sqlite es backend → inválido como stackFrontend
    expect((await post('/api/runs', { idea: 'x', stackFrontend: 'express-sqlite' })).status).toBe(400);
    expect((await post('/api/runs', { idea: 'x', stackBackend: 'nextjs' })).status).toBe(400);
  });
});

describe('GET /api/jobs — enriquecido', () => {
  it('devuelve jobs + worker, con progreso del status.json del proyecto', async () => {
    seedApp('mi-app', { status: 'running' });
    writeJson(join(appsDir, 'mi-app', 'status.json'), {
      node: 'builder',
      status: 'building',
      step: 3,
      totalSteps: 6,
      ts: '2026-01-01T00:00:00Z',
    });
    await post('/api/runs', { idea: 'x', name: 'mi-app' });
    const { status, body } = await api('/api/jobs');
    expect(status).toBe(200);
    expect(body.worker).toBeDefined();
    const job = body.jobs.find((j) => j.args.includes('mi-app'));
    expect(job.projectSlug).toBe('mi-app');
    expect(job.progress).toEqual({ node: 'builder', status: 'building', step: 3, totalSteps: 6 });
  });

  it('worker.alive refleja el heartbeat de jobs/.worker', async () => {
    const { writeHeartbeat } = await import('../src/queue.js');
    expect((await api('/api/jobs')).body.worker.alive).toBe(false);
    writeHeartbeat(base);
    expect((await api('/api/jobs')).body.worker.alive).toBe(true);
  });
});

describe('logs del run', () => {
  const seedJob = async (args, status = 'running') => {
    const { writeFileSync } = await import('node:fs');
    mkdirSync(join(base, 'jobs'), { recursive: true });
    writeJson(join(base, 'jobs', '9.json'), { id: 9, args, status, createdAt: '2026-01-01T00:00:00Z' });
    writeFileSync(join(base, 'jobs', '9.log'), Array.from({ length: 250 }, (_, i) => `linea-${i}`).join('\n'));
  };

  it('GET /api/jobs/:id/log devuelve el tail del log del job', async () => {
    await seedJob(['--idea', 'x', '--name', 'mi-app']);
    const { status, body } = await api('/api/jobs/9/log?tail=10');
    expect(status).toBe(200);
    expect(body.jobId).toBe(9);
    expect(body.jobStatus).toBe('running');
    expect(body.log.lines).toHaveLength(10);
    expect(body.log.lines.at(-1)).toBe('linea-249');
    expect(body.log.truncated).toBe(true);
    expect(body.projectSlug).toBe('mi-app');
  });

  it('GET /api/jobs/:id/log con job inexistente → 404', async () => {
    expect((await api('/api/jobs/99/log')).status).toBe(404);
  });

  it('GET /api/projects/:slug/log resuelve el job del proyecto por slug', async () => {
    seedApp('mi-app');
    await seedJob(['--idea', 'x', '--name', 'mi-app'], 'done');
    const { status, body } = await api('/api/projects/mi-app/log?tail=3');
    expect(status).toBe(200);
    expect(body.jobId).toBe(9);
    expect(body.log.lines).toEqual(['linea-247', 'linea-248', 'linea-249']);
  });

  it('proyecto sin job → log null', async () => {
    seedApp('sin-job');
    const { body } = await api('/api/projects/sin-job/log');
    expect(body.jobId).toBeNull();
    expect(body.log).toBeNull();
  });
});

describe('detalle enriquecido + acción test', () => {
  const seedPkg = (slug, scripts = { test: 'vitest run', 'test:e2e': 'playwright test' }) => {
    const dir = seedApp(slug);
    writeJson(join(dir, 'package.json'), { name: slug, scripts });
    return dir;
  };

  it('GET /:slug expone scripts del package.json, stacks y testRun', async () => {
    seedPkg('app-uno');
    const { status, body } = await api('/api/projects/app-uno');
    expect(status).toBe(200);
    expect(body.scripts).toContainEqual({ name: 'test', command: 'vitest run' });
    expect(body.testRun).toBeNull();
    // app sin package.json → scripts vacío
    seedApp('app-sin-pkg');
    const sin = await api('/api/projects/app-sin-pkg');
    expect(sin.body.scripts).toEqual([]);
  });

  it('action test → 202 + corre npm test via startTest', async () => {
    seedPkg('app-uno');
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'test' });
    expect(status).toBe(202);
    expect(body.testRun.status).toBe('running');
    expect(startTestCalls).toHaveLength(1);
    expect(startTestCalls[0].commands).toEqual([['npm', 'test']]);
  });

  it('action test con e2e encadena npm run test:e2e', async () => {
    seedPkg('app-uno');
    const { status } = await post('/api/projects/app-uno/actions', { action: 'test', e2e: true });
    expect(status).toBe(202);
    expect(startTestCalls[0].commands).toEqual([
      ['npm', 'test'],
      ['npm', 'run', 'test:e2e'],
    ]);
  });

  it('400 sin script test / sin test:e2e pedido / 409 solo si el run sigue vivo', async () => {
    seedApp('app-sin-pkg');
    expect((await post('/api/projects/app-sin-pkg/actions', { action: 'test' })).status).toBe(400);

    const dir = seedPkg('app-uno', { test: 'vitest run' }); // sin test:e2e
    expect((await post('/api/projects/app-uno/actions', { action: 'test', e2e: true })).status).toBe(400);

    // 'running' con pid muerto/ausente = stale (dashboard caído) → no bloquea
    writeJson(join(dir, 'test-run.json'), { status: 'running', pid: 999999 });
    expect((await post('/api/projects/app-uno/actions', { action: 'test' })).status).toBe(202);
    expect(startTestCalls).toHaveLength(1);

    // 'running' con pid vivo (este mismo proceso) → 409
    writeJson(join(dir, 'test-run.json'), { status: 'running', pid: process.pid });
    const busy = await post('/api/projects/app-uno/actions', { action: 'test' });
    expect(busy.status).toBe(409);
  });

  it('GET /:slug/test-log devuelve el tail del output + el estado del run', async () => {
    const dir = seedPkg('app-uno');
    writeFileSync(join(dir, 'test-run.log'), Array.from({ length: 50 }, (_, i) => `out-${i}`).join('\n'));
    writeJson(join(dir, 'test-run.json'), { status: 'done', exitCode: 0 });
    const { status, body } = await api('/api/projects/app-uno/test-log?tail=5');
    expect(status).toBe(200);
    expect(body.testRun.status).toBe('done');
    expect(body.log.lines).toEqual(['out-45', 'out-46', 'out-47', 'out-48', 'out-49']);
    expect(body.log.truncated).toBe(true);
  });

  it('startTestRun real: corre comandos en serie, escribe estado y log', async () => {
    const { startTestRun } = await import('../src/dashboard/server.js');
    const dir = seedApp('app-real');
    startTestRun(
      dir,
      [
        [process.execPath, '-e', 'console.log("MARK-UNO")'],
        [process.execPath, '-e', 'console.log("MARK-DOS")'],
      ],
      'fake tests',
    );
    const deadline = Date.now() + 5000;
    let state;
    do {
      await new Promise((r) => setTimeout(r, 50));
      state = JSON.parse(readFileSync(join(dir, 'test-run.json'), 'utf8'));
    } while (state.status === 'running' && Date.now() < deadline);
    expect(state.status).toBe('done');
    expect(state.exitCode).toBe(0);
    const log = readFileSync(join(dir, 'test-run.log'), 'utf8');
    expect(log).toContain('MARK-UNO');
    expect(log).toContain('MARK-DOS');
  });

  it('startTestRun: comando que falla → status failed y corta la serie', async () => {
    const { startTestRun } = await import('../src/dashboard/server.js');
    const dir = seedApp('app-fail');
    startTestRun(
      dir,
      [
        [process.execPath, '-e', 'process.exit(3)'],
        [process.execPath, '-e', 'console.log("NUNCA")'],
      ],
      'fake tests',
    );
    const deadline = Date.now() + 5000;
    let state;
    do {
      await new Promise((r) => setTimeout(r, 50));
      state = JSON.parse(readFileSync(join(dir, 'test-run.json'), 'utf8'));
    } while (state.status === 'running' && Date.now() < deadline);
    expect(state.status).toBe('failed');
    expect(state.exitCode).toBe(3);
    expect(readFileSync(join(dir, 'test-run.log'), 'utf8')).not.toContain('NUNCA');
  });
});
