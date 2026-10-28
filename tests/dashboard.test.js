import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../src/dashboard/server.js';
import { config } from '../src/config.js';

let base, appsDir, runsDir, server, url, startTestCalls, startBuildCalls, startDevCalls, stopDevCalls, fakeEngine, runCmdCalls, runCmdHandler, settingsPath, agentStatus;

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
  startBuildCalls = [];
  startDevCalls = [];
  stopDevCalls = [];
  fakeEngine = null;
  runCmdCalls = [];
  runCmdHandler = () => ({ ok: true, stdout: '', stderr: '' });
  appsDir = join(base, 'generated-apps');
  runsDir = join(base, 'runs');
  settingsPath = join(base, 'settings.json');
  agentStatus = {}; // id → {installed, auth, detail?} para agentProbe
  // Engine configurado por default — /api/runs lo exige desde el setup
  // gate; los tests del gate lo borran explícitamente.
  writeFileSync(settingsPath, JSON.stringify({ engine: 'devin' }));
  mkdirSync(appsDir, { recursive: true });
  const app = createDashboardApp({
    appsDir,
    runsDir,
    baseDir: base,
    startBuild: (...args) => {
      startBuildCalls.push(args);
      return { status: 'running', tag: 'fake:local' };
    },
    startTest: (dir, commands, label) => {
      startTestCalls.push({ dir, commands, label });
      return { status: 'running', command: label, startedAt: '2026-01-01T00:00:00Z' };
    },
    startDev: (dir) => {
      startDevCalls.push(dir);
      return { status: 'running', procs: [{ script: 'dev', pid: process.pid, port: 5173 }] };
    },
    stopDev: (dir) => {
      stopDevCalls.push(dir);
      return { stopped: true };
    },
    engineProbe: async () => fakeEngine,
    engineTtlMs: 0, // sin cache negativo → fakeEngine se puede cambiar mid-test
    settingsPath,
    agentProbe: async (engine) =>
      agentStatus[engine.id] ?? { installed: false, auth: 'missing' },
    runCmd: async (cmd) => {
      runCmdCalls.push(cmd);
      return runCmdHandler(cmd);
    },
  });
  await new Promise((resolveListen) => {
    server = app.listen(0, '127.0.0.1', resolveListen);
  });
  url = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  // maxRetries: un write stream recién cerrado puede recrear el archivo
  // mientras rmSync recorre el árbol → ENOTEMPTY transitorio en CI.
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

  it('expone engines + engine configurado (null sin settings)', async () => {
    rmSync(settingsPath, { force: true });
    const { body } = await api('/api/options');
    expect(body.engines).toEqual(['devin', 'opencode']);
    expect(body.engine).toBeNull();
  });
});

describe('setup gate — /api/engines, /api/settings y guard de /api/runs', () => {
  it('GET /api/engines devuelve probe por engine + configured null', async () => {
    rmSync(settingsPath, { force: true });
    agentStatus.devin = { installed: true, auth: 'ok' };
    const { status, body } = await api('/api/engines');
    expect(status).toBe(200);
    expect(body.engine).toBeNull();
    const devin = body.engines.find((e) => e.id === 'devin');
    expect(devin).toMatchObject({ installed: true, auth: 'ok', bin: expect.any(String) });
    const opencode = body.engines.find((e) => e.id === 'opencode');
    expect(opencode.installed).toBe(false);
    expect(opencode.installHint).toBeTruthy();
    expect(opencode.docsUrl).toMatch(/^https:\/\//);
  });

  it('POST /api/settings valida el id y persiste en settings.json', async () => {
    expect((await post('/api/settings', { engine: 'nope' })).status).toBe(400);
    const { status, body } = await post('/api/settings', { engine: 'opencode' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).engine).toBe('opencode');
    // /api/options ahora reporta el engine configurado
    expect((await api('/api/options')).body.engine).toBe('opencode');
  });

  it('POST /api/runs 400 sin engine configurado; con agent explícito encola', async () => {
    rmSync(settingsPath, { force: true });
    const bad = await post('/api/runs', { idea: 'app de prueba' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/motor de agente/);

    const ok = await post('/api/runs', { idea: 'app de prueba', agent: 'opencode' });
    expect(ok.status).toBe(201);
    expect(ok.body.job.args).toContain('--agent');
    expect(ok.body.job.args).toContain('opencode');
  });

  it('POST /api/runs funciona sin agent explícito una vez configurado', async () => {
    writeFileSync(settingsPath, JSON.stringify({ engine: 'devin' }));
    const { status } = await post('/api/runs', { idea: 'app de prueba' });
    expect(status).toBe(201);
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
  it('resume encola --resume <slug> --yes (sin flags de deploy: usa plan.deploy)', async () => {
    seedApp('app-uno');
    const { status, body } = await post('/api/projects/app-uno/actions', {
      action: 'resume',
      github: true,
      ghpages: true,
    });
    expect(status).toBe(201);
    expect(body.job.args).toEqual(['--resume', 'app-uno', '--yes']);
  });

  it('add-backend encola --extend <slug> --yes con flags opcionales', async () => {
    seedApp('solo-front');
    const { status, body } = await post('/api/projects/solo-front/actions', {
      action: 'add-backend',
      idea: 'api de productos y pedidos',
      arch: 'mvc',
      github: true,
      ghpages: true,
    });
    expect(status).toBe(201);
    expect(body.job.args).toEqual([
      '--extend',
      'solo-front',
      '--yes',
      '--idea',
      'api de productos y pedidos',
      '--arch',
      'mvc',
      '--github',
      '--ghpages',
    ]);
  });

  it('add-backend sin github → --no-push; con server/ → 409', async () => {
    seedApp('front-dos');
    const { status, body } = await post('/api/projects/front-dos/actions', {
      action: 'add-backend',
    });
    expect(status).toBe(201);
    expect(body.job.args).toEqual(['--extend', 'front-dos', '--yes', '--no-push']);

    const dir = seedApp('ya-fullstack');
    mkdirSync(join(dir, 'server'), { recursive: true });
    expect(
      (await post('/api/projects/ya-fullstack/actions', { action: 'add-backend' })).status,
    ).toBe(409);
  });

  it('api-surface escanea server/routes y arma /api/<file><path>', async () => {
    const dir = seedApp('con-api');
    mkdirSync(join(dir, 'server', 'routes'), { recursive: true });
    writeFileSync(
      join(dir, 'server', 'routes', 'products.js'),
      "router.get('/', (req, res) => {});\nrouter.post('/nuevo', (req, res) => {});\nrouter.delete('/:id', (req, res) => {});\n",
    );
    const { status, body } = await api('/api/projects/con-api/api-surface');
    expect(status).toBe(200);
    expect(body.endpoints).toEqual([
      { method: 'GET', path: '/api/products/', file: 'products.js' },
      { method: 'POST', path: '/api/products/nuevo', file: 'products.js' },
      { method: 'DELETE', path: '/api/products/:id', file: 'products.js' },
    ]);
    // proyecto sin backend → lista vacía
    seedApp('sin-api');
    expect((await api('/api/projects/sin-api/api-surface')).body.endpoints).toEqual([]);
  });

  it('GET /:slug/repo sin git → nulls; con remote + gh-pages → repoUrl + pagesUrl', async () => {
    seedApp('sin-git');
    expect(await api('/api/projects/sin-git/repo')).toEqual({
      status: 200,
      body: { repoUrl: null, pagesUrl: null },
    });

    seedApp('con-repo');
    runCmdHandler = (cmd) => {
      if (cmd.includes('ls-remote')) return { ok: true, stdout: 'abc123\trefs/heads/gh-pages\n' };
      if (cmd.includes('remote get-url')) {
        return { ok: true, stdout: 'git@github.com:tester/con-repo.git\n' };
      }
      return { ok: true, stdout: '', stderr: '' };
    };
    const { status, body } = await api('/api/projects/con-repo/repo');
    expect(status).toBe(200);
    expect(body.repoUrl).toBe('https://github.com/tester/con-repo');
    expect(body.pagesUrl).toBe('https://tester.github.io/con-repo/');

    // mismo remote pero sin branch gh-pages → pagesUrl null
    runCmdHandler = (cmd) =>
      cmd.includes('remote get-url')
        ? { ok: true, stdout: 'https://github.com/tester/con-repo.git\n' }
        : { ok: true, stdout: '', stderr: '' };
    expect((await api('/api/projects/con-repo/repo')).body.pagesUrl).toBeNull();
  });

  it('publish async: 202 + publish.json done/failed; gh-pages solo con ghpages:true', async () => {
    const dir = seedApp('para-publicar');
    mkdirSync(join(dir, 'dist'), { recursive: true }); // el "build" fake no genera nada
    const prevToken = config.githubToken;
    config.githubToken = 'fake-token'; // hermético: sin depender del .env real
    const readPub = () => JSON.parse(readFileSync(join(dir, 'publish.json'), 'utf8'));
    const settle = async () => {
      for (let i = 0; i < 50 && readPub().status === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      return readPub();
    };
    const ghCalls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u, opts) => {
      const s = String(u);
      if (s.includes('api.github.com')) {
        ghCalls.push(`${opts?.method ?? 'GET'} ${s.split('api.github.com')[1]}`);
        if (s.endsWith('/user')) return Response.json({ login: 'tester' });
        return Response.json({}, { status: 201 });
      }
      return origFetch(u, opts);
    };
    try {
      const { status, body } = await post('/api/projects/para-publicar/actions', { action: 'publish' });
      expect(status).toBe(202);
      expect(body.status).toBe('running');
      const done = await settle();
      expect(done).toMatchObject({
        status: 'done',
        repoUrl: 'https://github.com/tester/para-publicar',
        pagesUrl: null,
      });
      expect(ghCalls).toContain('POST /user/repos');
      const cmds = runCmdCalls.map((c) => c);
      expect(cmds.some((c) => c.includes('push -u origin main'))).toBe(true);
      // sin ghpages: no hay build ni push de gh-pages
      expect(cmds.some((c) => c.includes('gh-pages') || c.includes('npm run build'))).toBe(false);

      // con ghpages → build + push -f gh-pages + POST /pages
      runCmdCalls = [];
      ghCalls.length = 0;
      const ok = await post('/api/projects/para-publicar/actions', {
        action: 'publish',
        ghpages: true,
      });
      expect(ok.status).toBe(202);
      expect((await settle()).pagesUrl).toBe('https://tester.github.io/para-publicar/');
      const cmds2 = runCmdCalls.map((c) => c);
      expect(cmds2.some((c) => c.includes('npm run build'))).toBe(true);
      expect(cmds2.some((c) => c.includes('push -f origin gh-pages'))).toBe(true);
      expect(ghCalls.some((c) => c.startsWith('POST /repos/tester/para-publicar/pages'))).toBe(true);

      // publish.log persiste el output crudo del pipeline (git/build/deploy)
      const pubLog = readFileSync(join(dir, 'publish.log'), 'utf8');
      expect(pubLog).toContain('push -f origin gh-pages');
      expect(pubLog).toContain('npm run build');
      // el token nunca llega al log — ni literal ni en base64 del extraHeader
      expect(pubLog).not.toContain('fake-token');
      expect(pubLog).not.toContain(
        Buffer.from('x-access-token:fake-token').toString('base64'),
      );
      expect(pubLog).toContain('Authorization: Basic ***');
      const pl = await api('/api/projects/para-publicar/publish-log');
      expect(pl.status).toBe(200);
      expect(pl.body.publish.status).toBe('done');
      expect(pl.body.log.lines.join('\n')).toContain('push -f origin gh-pages');

      // push a gh-pages falla → pagesError honesto, sin pagesUrl que 404
      runCmdCalls = [];
      runCmdHandler = (cmd) =>
        cmd.includes('push -f origin gh-pages')
          ? { ok: false, stdout: '', stderr: 'denied: permission' }
          : { ok: true, stdout: '', stderr: '' };
      const pagesFail = await post('/api/projects/para-publicar/actions', {
        action: 'publish',
        ghpages: true,
      });
      expect(pagesFail.status).toBe(202);
      const failed = await settle();
      expect(failed.status).toBe('done'); // el push a main sí salió
      expect(failed.repoUrl).toBe('https://github.com/tester/para-publicar');
      expect(failed.pagesUrl).toBeNull();
      expect(failed.pagesError).toContain('push gh-pages falló');
      expect(readFileSync(join(dir, 'publish.log'), 'utf8')).toContain('denied: permission');
      runCmdHandler = () => ({ ok: true, stdout: '', stderr: '' });

      // publish en curso → 409: el primero queda colgado (runCmd no
      // resuelve nunca) y el segundo pega en el guard de publish.json.
      runCmdHandler = () => new Promise(() => {});
      const first = await post('/api/projects/para-publicar/actions', { action: 'publish' });
      expect(first.status).toBe(202);
      const busy = await post('/api/projects/para-publicar/actions', { action: 'publish' });
      expect(busy.status).toBe(409);
      runCmdHandler = () => ({ ok: true, stdout: '', stderr: '' });
    } finally {
      globalThis.fetch = origFetch;
      config.githubToken = prevToken;
    }
  });

  it('publish sin GITHUB_TOKEN → 503', async () => {
    seedApp('sin-token');
    const prev = config.githubToken;
    config.githubToken = '';
    try {
      const { status, body } = await post('/api/projects/sin-token/actions', { action: 'publish' });
      expect(status).toBe(503);
      expect(body.error).toContain('GITHUB_TOKEN');
    } finally {
      config.githubToken = prev;
    }
  });

  it('dockerize escribe Dockerfile y reporta skipped sin engine; con engine buildea', async () => {
    const dir = seedApp('app-uno');
    mkdirSync(join(dir, 'server'));
    writeFileSync(join(dir, 'vite.config.js'), '');
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'dockerize' });
    expect(status).toBe(200);
    expect(body.variant).toBe('fullstack');
    expect(body.build.status).toBe('skipped');
    expect(existsSync(join(dir, 'Dockerfile'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'docker-build.json'), 'utf8')).status).toBe('skipped');

    // con engine (podman) → 202 y el build se dispara con ese binario
    fakeEngine = 'podman';
    const ok = await post('/api/projects/app-uno/actions', { action: 'dockerize' });
    expect(ok.status).toBe(202);
    expect(startBuildCalls.at(-1)).toEqual([dir, 'app-uno', 'podman']);
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

describe('POST /api/jobs/:id/cancel', () => {
  const seedJob = (status) => {
    mkdirSync(join(base, 'jobs'), { recursive: true });
    writeJson(join(base, 'jobs', '9.json'), {
      id: 9,
      args: ['--idea', 'x'],
      status,
      createdAt: '2026-01-01T00:00:00Z',
    });
  };

  it('pending → cancelled al toque', async () => {
    seedJob('pending');
    const { status, body } = await api('/api/jobs/9/cancel', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.status).toBe('cancelled');
    const job = JSON.parse(readFileSync(join(base, 'jobs', '9.json'), 'utf8'));
    expect(job.status).toBe('cancelled');
    expect(job.finishedAt).toBeTruthy();
  });

  it('running → cancelling + flag cancelRequested (el worker mata)', async () => {
    seedJob('running');
    const { status, body } = await api('/api/jobs/9/cancel', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.status).toBe('cancelling');
    const job = JSON.parse(readFileSync(join(base, 'jobs', '9.json'), 'utf8'));
    expect(job.cancelRequested).toBe(true);
    expect(job.status).toBe('running'); // el close del worker lo marca cancelled
  });

  it('terminado → 409, inexistente → 404', async () => {
    seedJob('done');
    expect((await api('/api/jobs/9/cancel', { method: 'POST' })).status).toBe(409);
    expect((await api('/api/jobs/77/cancel', { method: 'POST' })).status).toBe(404);
  });
});

describe('POST /api/jobs/:id/requeue', () => {
  const seedJob = (status) => {
    mkdirSync(join(base, 'jobs'), { recursive: true });
    writeJson(join(base, 'jobs', '9.json'), {
      id: 9,
      args: ['--idea', 'blog de gatos', '--yes', '--scope', 'frontend', '--no-push'],
      status,
      createdAt: '2026-01-01T00:00:00Z',
    });
  };

  it('failed/cancelled → 201 re-encola los mismos args', async () => {
    for (const st of ['failed', 'cancelled']) {
      seedJob(st);
      const { status, body } = await api('/api/jobs/9/requeue', { method: 'POST' });
      expect(status).toBe(201);
      expect(body.job.id).not.toBe(9);
      expect(body.job.status).toBe('pending');
      expect(body.job.args).toEqual([
        '--idea', 'blog de gatos', '--yes', '--scope', 'frontend', '--no-push',
      ]);
      // el nuevo job quedó persistido en la cola
      const jobs = JSON.parse(
        readFileSync(join(base, 'jobs', `${body.job.id}.json`), 'utf8'),
      );
      expect(jobs.status).toBe('pending');
    }
  });

  it('pending/running → 409 (no se duplica), inexistente → 404', async () => {
    seedJob('running');
    expect((await api('/api/jobs/9/requeue', { method: 'POST' })).status).toBe(409);
    seedJob('pending');
    expect((await api('/api/jobs/9/requeue', { method: 'POST' })).status).toBe(409);
    expect((await api('/api/jobs/77/requeue', { method: 'POST' })).status).toBe(404);
  });
});

describe('POST /api/jobs/clear', () => {
  const seedJob = (id, status) => {
    mkdirSync(join(base, 'jobs'), { recursive: true });
    writeJson(join(base, 'jobs', `${id}.json`), {
      id,
      args: ['--idea', 'x'],
      status,
      createdAt: '2026-01-01T00:00:00Z',
    });
  };

  it('borra json+log de terminados y conserva pending/running', async () => {
    seedJob(1, 'done');
    seedJob(2, 'failed');
    seedJob(3, 'cancelled');
    seedJob(4, 'pending');
    seedJob(5, 'running');
    writeFileSync(join(base, 'jobs', '1.log'), 'log');
    const { status, body } = await api('/api/jobs/clear', { method: 'POST' });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, removed: 3 });
    expect(existsSync(join(base, 'jobs', '1.json'))).toBe(false);
    expect(existsSync(join(base, 'jobs', '1.log'))).toBe(false);
    const { body: list } = await api('/api/jobs');
    expect(list.jobs.map((j) => j.id)).toEqual([4, 5]);
  });

  it('todo activo → removed 0 y no toca nada', async () => {
    seedJob(7, 'pending');
    const { status, body } = await api('/api/jobs/clear', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.removed).toBe(0);
    expect(existsSync(join(base, 'jobs', '7.json'))).toBe(true);
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
    // y el detalle lo reporta con stale:true para que la UI lo sepa.
    writeJson(join(dir, 'test-run.json'), { status: 'running', pid: 999999 });
    expect((await api('/api/projects/app-uno')).body.testRun.stale).toBe(true);
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

describe('runtime de containers (docker/podman)', () => {
  it('GET /api/runtime reporta el engine detectado (o null)', async () => {
    expect((await api('/api/runtime')).body.engine).toBeNull();
    fakeEngine = 'podman';
    expect((await api('/api/runtime')).body.engine).toBe('podman');
  });

  it('detalle expone runtime: engine, container vivo y puertos sugeridos', async () => {
    const dir = seedApp('app-uno');
    mkdirSync(join(dir, 'server')); // fullstack → containerPort 4000
    fakeEngine = 'docker';
    runCmdHandler = (cmd) =>
      cmd.includes('ps --filter')
        ? { ok: true, stdout: 'app-uno 0.0.0.0:4000->4000/tcp' }
        : { ok: true, stdout: '' };
    const { body } = await api('/api/projects/app-uno');
    expect(body.runtime.engine).toBe('docker');
    expect(body.runtime.image).toBe(true); // image inspect ok por default
    expect(body.runtime.container).toEqual({
      name: 'app-uno', running: true, hostPort: 4000, containerPort: 4000,
    });
    expect(body.runtime.suggested).toEqual({ containerPort: 4000, suggestedHostPort: 4000 });
  });

  it('frontend-only sugiere nginx :80 → host 8080', async () => {
    const dir = seedApp('app-front');
    writeFileSync(join(dir, 'vite.config.js'), ''); // frontend sin server/
    fakeEngine = 'docker';
    const { body } = await api('/api/projects/app-front');
    expect(body.runtime.suggested).toEqual({ containerPort: 80, suggestedHostPort: 8080 });
    expect(body.runtime.container).toBeNull();
  });

  it('run-container: 503 sin engine, 400 sin imagen, 201 corre docker run', async () => {
    const dir = seedApp('app-uno');
    mkdirSync(join(dir, 'server'));

    // sin engine → 503
    expect((await post('/api/projects/app-uno/actions', { action: 'run-container' })).status).toBe(503);

    fakeEngine = 'docker';
    // imagen inexistente → 400
    runCmdHandler = (cmd) =>
      cmd.includes('image inspect') ? { ok: false, stderr: 'no such image' } : { ok: true, stdout: '' };
    const noImg = await post('/api/projects/app-uno/actions', { action: 'run-container' });
    expect(noImg.status).toBe(400);
    expect(noImg.body.error).toContain('Dockerize');

    // imagen ok → 201 + docker run con puertos correctos (rm -f previo)
    runCmdHandler = () => ({ ok: true, stdout: 'abc123' });
    runCmdCalls = [];
    // port no entero → 400 explícito (no fallback silencioso)
    expect((await post('/api/projects/app-uno/actions', { action: 'run-container', port: 'abc' })).status).toBe(400);
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'run-container', port: 5050 });
    expect(status).toBe(201);
    expect(body.container).toEqual({ name: 'app-uno', hostPort: 5050, containerPort: 4000, engine: 'docker' });
    expect(runCmdCalls).toContain('docker rm -f app-uno');
    expect(runCmdCalls).toContain('docker run -d --name app-uno -p 5050:4000 app-uno:local');
  });

  it('run-container usa el puerto sugerido cuando no se pasa port', async () => {
    const dir = seedApp('app-front');
    writeFileSync(join(dir, 'vite.config.js'), '');
    fakeEngine = 'podman';
    runCmdHandler = () => ({ ok: true, stdout: '' });
    runCmdCalls = [];
    const { status } = await post('/api/projects/app-front/actions', { action: 'run-container' });
    expect(status).toBe(201);
    expect(runCmdCalls).toContain('podman run -d --name app-front -p 8080:80 app-front:local');
  });

  it('stop-container hace rm -f del container', async () => {
    seedApp('app-uno');
    fakeEngine = 'docker';
    runCmdCalls = [];
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'stop-container' });
    expect(status).toBe(200);
    expect(body.stopped).toBe(true);
    expect(runCmdCalls).toContain('docker rm -f app-uno');
  });

  it('container-log: logs del container si corre, running:false si no', async () => {
    seedApp('app-uno');
    fakeEngine = 'docker';
    runCmdHandler = (cmd) => {
      if (cmd.includes('ps --filter')) return { ok: true, stdout: 'app-uno 0.0.0.0:4000->4000/tcp' };
      if (cmd.includes('logs --tail')) return { ok: true, stdout: 'GET /api/health 200\nGET /api/products 200\n' };
      return { ok: true, stdout: '' };
    };
    const { status, body } = await api('/api/projects/app-uno/container-log?tail=10');
    expect(status).toBe(200);
    expect(body.running).toBe(true);
    expect(body.log.lines).toEqual(['GET /api/health 200', 'GET /api/products 200']);

    runCmdHandler = (cmd) =>
      cmd.includes('ps --filter') ? { ok: true, stdout: '' } : { ok: true, stdout: '' };
    const off = await api('/api/projects/app-uno/container-log');
    expect(off.body.running).toBe(false);
    expect(off.body.log).toBeNull();
  });
});

describe('run-dev sin containers', () => {
  const seedDevApp = (slug, scripts = { dev: 'vite', api: 'node server/index.js' }) => {
    const dir = seedApp(slug);
    writeJson(join(dir, 'package.json'), { name: slug, scripts });
    return dir;
  };

  it('run-dev → 202 y dispara startDev; stop-dev → stopped', async () => {
    const dir = seedDevApp('app-uno');
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'run-dev' });
    expect(status).toBe(202);
    expect(startDevCalls).toEqual([dir]);
    expect(body.devRun.status).toBe('running');

    const stop = await post('/api/projects/app-uno/actions', { action: 'stop-dev' });
    expect(stop.status).toBe(200);
    expect(stop.body.stopped).toBe(true);
    expect(stopDevCalls).toEqual([dir]);
  });

  it('400 sin scripts dev/api; detalle expone devTargets por script', async () => {
    seedApp('app-sin-scripts');
    expect((await post('/api/projects/app-sin-scripts/actions', { action: 'run-dev' })).status).toBe(400);

    // vite (sin next.config) → dev:5173 + api:4000
    seedDevApp('app-vite');
    const vite = await api('/api/projects/app-vite');
    expect(vite.body.devTargets).toEqual([
      { script: 'dev', port: 5173 },
      { script: 'api', port: 4000 },
    ]);

    // next.config.mjs → dev:3000; backend-only → solo api
    const dirNext = seedDevApp('app-next', { dev: 'next dev' });
    writeFileSync(join(dirNext, 'next.config.mjs'), '');
    expect((await api('/api/projects/app-next')).body.devTargets).toEqual([{ script: 'dev', port: 3000 }]);
    seedDevApp('app-back', { api: 'node server/index.js' });
    expect((await api('/api/projects/app-back')).body.devTargets).toEqual([{ script: 'api', port: 4000 }]);
  });

  it('409 si el dev run sigue vivo; running con pids muertos = stale → relanza', async () => {
    const dir = seedDevApp('app-uno');
    writeJson(join(dir, 'dev-run.json'), {
      status: 'running',
      procs: [{ script: 'dev', pid: process.pid, port: 5173, alive: true }],
    });
    expect((await post('/api/projects/app-uno/actions', { action: 'run-dev' })).status).toBe(409);

    writeJson(join(dir, 'dev-run.json'), {
      status: 'running',
      procs: [{ script: 'dev', pid: 999999, port: 5173, alive: true }],
    });
    expect((await api('/api/projects/app-uno')).body.devRun.stale).toBe(true);
    expect((await post('/api/projects/app-uno/actions', { action: 'run-dev' })).status).toBe(202);
  });

  it('dev-log devuelve tail del log + urls parseadas del output', async () => {
    const dir = seedDevApp('app-uno');
    writeFileSync(
      join(dir, 'dev-run.log'),
      'arrancando\n  ➜  Local:   http://localhost:5174/\napi en http://localhost:4000\n',
    );
    writeJson(join(dir, 'dev-run.json'), { status: 'exited', procs: [] });
    const { status, body } = await api('/api/projects/app-uno/dev-log');
    expect(status).toBe(200);
    expect(body.devRun.status).toBe('exited');
    expect(body.log.lines.join('\n')).toContain('localhost:4000');
    expect(body.urls).toEqual(['http://localhost:5174', 'http://localhost:4000']);
  });

  it('startDevRun real: spawn npm run <script> detached por target', async () => {
    const { startDevRun } = await import('../src/dashboard/server.js');
    const { EventEmitter } = await import('node:events');
    const dir = seedDevApp('app-fake');
    const spawned = [];
    // Emite close → el log stream cierra (sin esto el WriteStream queda
    // abierto y su open lazy puede recrear dev-run.log DURANTE el rmSync
    // del afterEach → ENOTEMPTY en CI).
    const fakeChild = () => {
      const c = new EventEmitter();
      c.pid = process.pid;
      c.stdout = null;
      c.stderr = null;
      setImmediate(() => c.emit('close', 1));
      return c;
    };
    const state = startDevRun(dir, {
      spawnFn: (cmd, args, opts) => {
        spawned.push({ cmd, args, cwd: opts.cwd, detached: opts.detached });
        return fakeChild();
      },
    });
    expect(state.procs).toMatchObject([
      { script: 'dev', port: 5173 },
      { script: 'api', port: 4000 },
    ]);
    expect(spawned).toEqual([
      { cmd: 'npm', args: ['run', 'dev'], cwd: dir, detached: true },
      { cmd: 'npm', args: ['run', 'api'], cwd: dir, detached: true },
    ]);
    // Esperar status 'exited': ese write corre dentro de log.end() →
    // garantiza que el WriteStream ya abrió y cerró su fd. Emitir close
    // solo con setImmediate no basta: el fs.open lazy puede caer DENTRO
    // del rmSync del afterEach y recrear dev-run.log → ENOTEMPTY en CI.
    for (let i = 0; i < 100; i++) {
      const s = JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8'));
      if (s.status === 'exited') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8')).status).toBe('exited');
  });

  it('ciclo de vida real: startDevRun + stopDevRun mata el process group', async () => {
    const { spawn } = await import('node:child_process');
    const { startDevRun, stopDevRun } = await import('../src/dashboard/server.js');
    const dir = seedDevApp('app-real', { dev: 'sleep forever' });
    startDevRun(dir, {
      // npm run dev → en realidad un node dormilón detached (grupo propio)
      spawnFn: () =>
        spawn(process.execPath, ['-e', 'console.log("Local: http://localhost:5199"); setInterval(()=>{},60000)'], {
          cwd: dir,
          detached: true,
        }),
    });
    let state = JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8'));
    const pid = state.procs[0].pid;
    expect(state.status).toBe('running');
    const detail = await api('/api/projects/app-real');
    expect(detail.body.devRun.stale).toBeFalsy();

    // el log captura la URL impresa por el proceso
    await new Promise((r) => setTimeout(r, 300));
    const { body } = await api('/api/projects/app-real/dev-log');
    expect(body.urls).toContain('http://localhost:5199');

    const { stopped } = stopDevRun(dir);
    expect(stopped).toBe(true);
    state = JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8'));
    expect(state.status).toBe('stopped');
    // el grupo entero (node + descendientes) quedó muerto
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('race stop→run: el close de la sesión vieja no pisa el estado nuevo', async () => {
    const { spawn } = await import('node:child_process');
    const { startDevRun, stopDevRun } = await import('../src/dashboard/server.js');
    const dir = seedDevApp('app-race', { dev: 'x' });
    const sleeper = () =>
      spawn(process.execPath, ['-e', 'setInterval(()=>{},60000)'], { cwd: dir, detached: true });
    // sesión A corre, se detiene y se arranca B al toque: el close
    // tardío de A no debe pisar el dev-run.json de B.
    startDevRun(dir, { spawnFn: sleeper });
    stopDevRun(dir);
    startDevRun(dir, { spawnFn: sleeper });
    const pidB = JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8')).procs[0].pid;
    await new Promise((r) => setTimeout(r, 500)); // el close de A ya llegó
    const state = JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8'));
    expect(state.status).toBe('running');
    expect(state.procs[0].pid).toBe(pidB);
    expect(state.procs[0].alive).toBe(true);
    stopDevRun(dir); // limpieza de B
  });
});

describe('eliminar proyecto', () => {
  it('delete → borra el dir, frena el dev run y limpia container+imagen con engine', async () => {
    const dir = seedApp('app-uno');
    writeJson(join(dir, 'dev-run.json'), {
      status: 'running',
      procs: [{ script: 'dev', pid: process.pid, port: 5173, alive: true }],
    });
    fakeEngine = 'podman';
    runCmdCalls = [];
    const { status, body } = await post('/api/projects/app-uno/actions', { action: 'delete' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ deleted: true, slug: 'app-uno' });
    expect(existsSync(dir)).toBe(false);
    expect(stopDevCalls).toEqual([dir]);
    expect(runCmdCalls).toContain('podman rm -f app-uno');
    expect(runCmdCalls).toContain('podman rmi -f app-uno:local');
    expect((await api('/api/projects/app-uno')).status).toBe(404);
  });

  it('sin engine borra el dir igual (salta container/imagen)', async () => {
    const dir = seedApp('app-uno');
    runCmdCalls = [];
    const { status } = await post('/api/projects/app-uno/actions', { action: 'delete' });
    expect(status).toBe(200);
    expect(existsSync(dir)).toBe(false);
    expect(runCmdCalls.filter((c) => c.includes('rm -f') || c.includes('rmi'))).toHaveLength(0);
  });

  it('409 con job pending/running del proyecto; job terminado no bloquea', async () => {
    const dir = seedApp('app-uno');
    mkdirSync(join(base, 'jobs'), { recursive: true });
    writeJson(join(base, 'jobs', '5.json'), {
      id: 5,
      args: ['--idea', 'x', '--name', 'app-uno'],
      status: 'running',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const busy = await post('/api/projects/app-uno/actions', { action: 'delete' });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toContain('cancelalo');
    expect(existsSync(dir)).toBe(true);

    writeJson(join(base, 'jobs', '5.json'), {
      id: 5,
      args: ['--idea', 'x', '--name', 'app-uno'],
      status: 'cancelled',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect((await post('/api/projects/app-uno/actions', { action: 'delete' })).status).toBe(200);
    expect(existsSync(dir)).toBe(false);
  });

  it('delete funciona en dir sin plan.json (run muerto en preflight)', async () => {
    const dir = join(appsDir, 'app-huerfana');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'algo.txt'), 'x');
    const { status, body } = await post('/api/projects/app-huerfana/actions', { action: 'delete' });
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(existsSync(dir)).toBe(false);
    // las demás acciones siguen exigiendo plan.json
    expect((await post('/api/projects/app-huerfana/actions', { action: 'resume' })).status).toBe(404);
    // slug inexistente → 404
    expect((await post('/api/projects/nope-nope/actions', { action: 'delete' })).status).toBe(404);
  });
});
