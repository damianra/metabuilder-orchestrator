// API del dashboard — Express sobre la infra existente del orquestador.
//
//   npm run dashboard:api   →  http://127.0.0.1:4100
//
// Es una capa fina: lista generated-apps/ leyendo plan.json/status.json,
// encola generaciones y resumes via src/queue.js (el worker las procesa),
// y dispara docker builds locales que reportan estado en
// docker-build.json dentro de la app. Bindea a 127.0.0.1 por default —
// es una herramienta local, no un servicio expuesto.

import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { addJob, cancelJob, jobsDir, readJobs, readWorker } from '../queue.js';
import { slugify } from '../tools/slug.js';
import { buildReport, resolveRunId } from '../report.js';
import { writeDockerFiles, detectFrontend, detectOutDir } from '../tools/docker.js';
import { listArchs } from '../arch/index.js';
import { getVertical, listVerticals } from '../verticals/index.js';
import { getStack, listStacks } from '../stacks/index.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const SCOPES = ['frontend', 'backend', 'fullstack'];

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data, null, 2) + '\n');

// ssh/scp-style → https, para que la UI pueda abrir el repo en el browser.
const toWebUrl = (remote) => {
  if (!remote) return null;
  const m = remote.match(/^(?:git@|ssh:\/\/git@)([^:/]+)[:/](.+?)(?:\.git)?$/);
  return m ? `https://${m[1]}/${m[2]}` : remote.replace(/\.git$/, '');
};

const buildStatePath = (dir) => join(dir, 'docker-build.json');
const readBuildState = (dir) => readJson(buildStatePath(dir));

const writeBuildState = (dir, state) => writeJson(buildStatePath(dir), state);

// docker build async: log crudo a docker-build.log, estado a
// docker-build.json — sobrevive al restart del dashboard (a diferencia
// de memoria) y el detalle del proyecto lo expone tal cual.
export function startDockerBuild(dir, slug, engine = 'docker') {
  const tag = `${slug}:local`;
  const state = { status: 'running', tag, engine, startedAt: new Date().toISOString() };
  writeBuildState(dir, state);
  const log = createWriteStream(join(dir, 'docker-build.log'), { flags: 'a' });
  const child = spawn(engine, ['build', '-t', tag, '.'], { cwd: dir });
  // end:false — si stdout cierra antes que stderr, el pipe default
  // haría end() y un chunk tardío de stderr sería write-after-end.
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on('close', (exitCode) => {
    log.end();
    writeBuildState(dir, {
      ...state,
      status: exitCode === 0 ? 'done' : 'failed',
      exitCode: exitCode ?? 1,
      finishedAt: new Date().toISOString(),
    });
  });
  return state;
}

const testStatePath = (dir) => join(dir, 'test-run.json');
const readTestState = (dir) => readJson(testStatePath(dir));
const writeTestState = (dir, state) => writeJson(testStatePath(dir), state);

// Test run async: mismo patrón que startDockerBuild — log crudo a
// test-run.log, estado a test-run.json. `commands` es una lista de
// argvs que corren en serie; falla el primero → status failed.
export function startTestRun(dir, commands, label) {
  // pid por comando: el guard de "running" lo usa para detectar runs
  // stale (dashboard muerto a mitad) y no bloquear para siempre.
  const state = { status: 'running', command: label, pid: null, startedAt: new Date().toISOString() };
  writeTestState(dir, state);
  const log = createWriteStream(join(dir, 'test-run.log'), { flags: 'a' });
  log.write(`\n━━ test run · ${label} · ${state.startedAt}\n`);
  let finished = false;
  const finish = (status, exitCode) => {
    if (finished) return; // 'error' + 'close' pueden disparar ambos (ENOENT)
    finished = true;
    // El estado final se escribe cuando el log ya flusheó — así quien
    // lee status 'done'/'failed' tiene el output completo en disco.
    log.end(() =>
      writeTestState(dir, { ...state, status, exitCode, finishedAt: new Date().toISOString() }),
    );
  };
  const runNext = (i) => {
    if (i >= commands.length) return finish('done', 0);
    const [cmd, ...args] = commands[i];
    log.write(`\n$ ${[cmd, ...args].join(' ')}\n`);
    const child = spawn(cmd, args, { cwd: dir });
    state.pid = child.pid;
    writeTestState(dir, state);
    // end:false — el stream lo cierra finish() explícitamente; con el
    // default, el primer stdout que termina haría end() y los writes
    // siguientes (stderr o el próximo comando) serían write-after-end.
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', (exitCode) => {
      if (exitCode === 0) runNext(i + 1);
      else finish('failed', exitCode > 0 ? exitCode : 1);
    });
    child.on('error', () => finish('failed', 1));
  };
  runNext(0);
  return state;
}

// ¿Sigue vivo el proceso del test run? Un 'running' con pid muerto es
// stale (dashboard caído a mitad) → no bloquea el relanzamiento.
const pidAlive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// testRun enriquecido: un 'running' con pid muerto se reporta con
// stale:true para que la UI no bloquee el botón de relanzar.
const readTestRun = (dir) => {
  const s = readTestState(dir);
  if (s?.status === 'running' && !pidAlive(s.pid)) return { ...s, stale: true };
  return s;
};

function projectSummary(dir, slug) {
  const plan = readJson(join(dir, 'plan.json'));
  const status = readJson(join(dir, 'status.json'));
  const steps = plan?.steps ?? [];
  return {
    slug,
    name: plan?.projectName ?? slug,
    appType: plan?.appType ?? null,
    scope: plan?.scope ?? null,
    arch: plan?.arch ?? null,
    status: status?.status ?? (plan ? 'unknown' : 'no-plan'),
    lastError: status?.lastError ?? null,
    steps: {
      total: steps.length,
      done: steps.filter((s) => s.status === 'done').length,
      failed: steps.filter((s) => s.status === 'failed').length,
    },
    hasDockerfile: existsSync(join(dir, 'Dockerfile')),
    updatedAt: status?.ts ?? statSync(dir).mtime.toISOString(),
  };
}

const detectVariant = (dir) => ({
  frontend: detectFrontend(dir),
  backend: existsSync(join(dir, 'server')),
  outDir: detectOutDir(dir),
});

// Puerto interno del container según la variante: frontend-only va por
// nginx en :80; backend y fullstack los sirve el Express en :4000.
const containerPorts = (dir) => {
  const v = detectVariant(dir);
  const containerPort = v.frontend && !v.backend ? 80 : 4000;
  return { containerPort, suggestedHostPort: containerPort === 80 ? 8080 : 4000 };
};

/**
 * App Express del dashboard. Deps inyectables para tests:
 * appsDir/runsDir/baseDir (jobs/), startBuild (el build real corre con
 * el engine detectado — en tests se inyecta un fake), startTest
 * (runner de tests), runCmd (ejecución de comandos de container) y
 * engineProbe (detección docker/podman).
 */
export function createDashboardApp({
  appsDir = config.generatedAppsDir,
  runsDir = config.runsDir,
  baseDir = config.rootDir,
  startBuild = startDockerBuild,
  startTest = startTestRun,
  runCmd = run,
  // docker primero, podman como fallback — el CLI de containers es
  // compatible, así que un solo binario alcanza para todas las acciones
  // (build/run/logs/rm).
  engineProbe = async () => {
    if ((await runCmd('docker info', { timeoutMs: 10_000 })).ok) return 'docker';
    if ((await runCmd('podman info', { timeoutMs: 10_000 })).ok) return 'podman';
    return null;
  },
  // TTL del cache negativo: positivo se cachea permanente (un daemon no
  // desaparece), pero `null` re-probea pasado el TTL — docker puede
  // aparecer después (Docker Desktop arrancando). Tests: 0 = sin cache.
  engineTtlMs = 30_000,
} = {}) {
  let engineCache = null;
  let engineProbedAt = -Infinity;
  const getEngine = async () => {
    if (engineCache) return engineCache; // positivo: permanente
    if (Date.now() - engineProbedAt < engineTtlMs) return null; // negativo: TTL
    engineCache = await engineProbe();
    engineProbedAt = Date.now();
    return engineCache;
  };
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const appDir = (slug) => join(appsDir, slug);
  const validSlug = (req, res) => {
    const { slug } = req.params;
    if (!SLUG_RE.test(slug) || !existsSync(join(appDir(slug), 'plan.json'))) {
      res.status(404).json({ error: `proyecto "${slug}" no encontrado` });
      return null;
    }
    return slug;
  };

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Opciones para los pickers de la UI — leídas de los registries, no
  // hardcodeadas en el frontend (un stack/vertical/arch nuevo aparece
  // solo al registrarse).
  app.get('/api/options', (req, res) =>
    res.json({
      scopes: SCOPES,
      appTypes: [...listVerticals(), 'custom'],
      archs: listArchs(),
      stacks: {
        frontend: listStacks('frontend').map((s) => s.id),
        backend: listStacks('backend').map((s) => s.id),
      },
    }),
  );

  app.get('/api/projects', (req, res) => {
    const slugs = existsSync(appsDir)
      ? readdirSync(appsDir).filter((d) => statSync(join(appsDir, d)).isDirectory())
      : [];
    res.json(slugs.map((s) => projectSummary(appDir(s), s)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  });

  // Slug del proyecto que un job toca: --name es el slug directo;
  // --resume apunta a un dir/slug existente; si no, se deriva de la
  // idea y se buscan los sufijos -2..-5 que ensureProjectDir pudo dar.
  const jobProjectSlug = (args = []) => {
    const at = (flag) => {
      const i = args.indexOf(flag);
      return i >= 0 ? args[i + 1] : null;
    };
    const resume = at('--resume');
    if (resume) return basename(resume.replace(/\/+$/, ''));
    // --name es el slug directo (el CLI lo slugifica igual) — se
    // resuelve aunque la app todavía no exista (job pending).
    const name = at('--name');
    if (name) return slugify(name);
    const base = slugify(at('--idea') ?? '');
    if (!base) return null;
    for (let i = 0; i < 5; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`;
      if (existsSync(join(appsDir, slug, 'plan.json'))) return slug;
    }
    return null;
  };

  // Job + progreso en vivo del pipeline (status.json de la app) +
  // liveness del worker — el stepper de la UI se arma con esto.
  app.get('/api/jobs', (req, res) => {
    const jobs = readJobs(baseDir).map((j) => {
      const slug = jobProjectSlug(j.args);
      const status = slug ? readJson(join(appsDir, slug, 'status.json')) : null;
      return {
        ...j,
        projectSlug: slug,
        progress: status
          ? {
              node: status.node ?? null,
              status: status.status ?? null,
              step: status.step ?? null,
              totalSteps: status.totalSteps ?? null,
            }
          : null,
      };
    });
    res.json({ jobs, worker: readWorker(baseDir) });
  });

  // Últimas `lines` de un log sin cargar el archivo entero: lee los
  // últimos `maxBytes` desde el final y devuelve líneas sueltas.
  const tailFile = (file, { lines = 200, maxBytes = 128 * 1024 } = {}) => {
    if (!existsSync(file)) return null;
    const size = statSync(file).size;
    const from = Math.max(0, size - maxBytes);
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      const all = buf.toString('utf8').split('\n');
      // Si cortamos a mitad de línea, la primera queda parcial: descartarla.
      const sliced = from > 0 ? all.slice(1) : all;
      const tail = sliced.slice(-lines);
      return { lines: tail, truncated: tail.length < all.length || from > 0 };
    } finally {
      closeSync(fd);
    }
  };

  app.get('/api/jobs/:id/log', (req, res) => {
    const job = readJobs(baseDir).find((j) => j.id === Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'job no encontrado' });
    const log = tailFile(join(jobsDir(baseDir), `${job.id}.log`), { lines: Number(req.query.tail) || 200 });
    res.json({ jobId: job.id, jobStatus: job.status, projectSlug: jobProjectSlug(job.args), log });
  });

  // Cancelar: pending → 'cancelled' al toque; running → flag
  // cancelRequested y el worker mata el árbol del subproceso (queda
  // 'cancelling' hasta que el close lo marque 'cancelled').
  app.post('/api/jobs/:id/cancel', (req, res) => {
    const out = cancelJob(Number(req.params.id), baseDir);
    if (!out.ok)
      return res
        .status(out.error.includes('no existe') ? 404 : 409)
        .json({ error: out.error });
    res.json(out);
  });

  // Log del pipeline del proyecto: el job más reciente cuyo slug matchea.
  app.get('/api/projects/:slug/log', (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const jobs = readJobs(baseDir).filter((j) => jobProjectSlug(j.args) === slug);
    const job = jobs.findLast((j) => j.status === 'running') ?? jobs.at(-1);
    if (!job) return res.json({ jobId: null, jobStatus: null, log: null });
    const log = tailFile(join(jobsDir(baseDir), `${job.id}.log`), { lines: Number(req.query.tail) || 200 });
    res.json({ jobId: job.id, jobStatus: job.status, log });
  });

  // Log del último "Ejecutar tests" sobre la app (test-run.log).
  app.get('/api/projects/:slug/test-log', (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const dir = appDir(slug);
    const log = tailFile(join(dir, 'test-run.log'), { lines: Number(req.query.tail) || 200 });
    res.json({ testRun: readTestRun(dir), log });
  });

  // Engine de containers disponible en la máquina (docker o podman).
  app.get('/api/runtime', async (req, res) => res.json({ engine: await getEngine() }));

  // Estado vivo del container del proyecto (docker ps filtrado por
  // nombre) — la fuente de verdad es el daemon, no un archivo.
  const containerStatus = async (dir, slug) => {
    const engine = await getEngine();
    if (!engine) return { engine: null, container: null, image: false };
    const [ps, img] = await Promise.all([
      runCmd(`${engine} ps --filter name=^/${slug}$ --format "{{.Names}} {{.Ports}}"`, { timeoutMs: 10_000 }),
      runCmd(`${engine} image inspect ${slug}:local`, { cwd: dir, timeoutMs: 10_000 }),
    ]);
    const m = ps.ok ? ps.stdout.match(/(\d+)->(\d+)/) : null;
    const running = ps.ok && ps.stdout.includes(slug);
    return {
      engine,
      image: img.ok,
      container: running
        ? { name: slug, running: true, hostPort: m ? Number(m[1]) : null, containerPort: m ? Number(m[2]) : null }
        : null,
    };
  };

  // Logs del container en ejecución (docker logs --tail) — solo si corre.
  app.get('/api/projects/:slug/container-log', async (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const { engine, container } = await containerStatus(appDir(slug), slug);
    if (!engine || !container) {
      return res.json({ engine, running: false, log: null });
    }
    const tail = Math.min(Math.max(Number(req.query.tail) || 200, 1), 500);
    const r = await runCmd(`${engine} logs --tail ${tail} ${slug}`, { timeoutMs: 15_000 });
    const out = r.ok ? r.stdout.replace(/\n+$/, '') : '';
    res.json({
      engine,
      running: true,
      container,
      log: r.ok && out ? { lines: out.split('\n') } : null,
      error: r.ok ? undefined : (r.stderr || 'no se pudo leer docker logs'),
    });
  });

  app.get('/api/projects/:slug', async (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const dir = appDir(slug);
    const plan = readJson(join(dir, 'plan.json'));
    const summary = projectSummary(dir, slug);
    const runId = resolveRunId(slug, runsDir);
    const remote = (await run('git remote get-url origin', { cwd: dir, timeoutMs: 5000 })).stdout.trim();
    const pkg = readJson(join(dir, 'package.json'));
    res.json({
      ...summary,
      idea: plan?.idea ?? null,
      planSteps: plan?.steps ?? [],
      validated: plan?.validated ?? false,
      stacks: plan?.stacks ?? null,
      scripts: Object.entries(pkg?.scripts ?? {}).map(([name, command]) => ({ name, command })),
      repoUrl: toWebUrl(remote || null),
      report: runId ? buildReport({ runId, runDir: join(runsDir, runId), projectDir: dir }) : null,
      dockerBuild: readBuildState(dir),
      testRun: readTestRun(dir),
      runtime: {
        ...(await containerStatus(dir, slug)),
        suggested: containerPorts(dir),
      },
    });
  });

  // Encola una generación (whitelist de campos → args del CLI; --yes
  // siempre: bajo el worker los prompts interactivos colgarían la cola).
  app.post('/api/runs', (req, res) => {
    const b = req.body ?? {};
    if (typeof b.idea !== 'string' || !b.idea.trim()) {
      return res.status(400).json({ error: 'idea requerida (string no vacío)' });
    }
    if (b.scope && !SCOPES.includes(b.scope)) {
      return res.status(400).json({ error: `scope inválido (${SCOPES.join('|')})` });
    }
    if (b.appType && b.appType !== 'custom' && !getVertical(b.appType)) {
      return res.status(400).json({ error: `appType desconocido "${b.appType}"` });
    }
    if (b.name && !SLUG_RE.test(b.name)) {
      return res.status(400).json({ error: 'name debe ser slug (a-z0-9-)' });
    }
    if (b.arch && !listArchs().includes(b.arch)) {
      return res.status(400).json({ error: `arch inválido (${listArchs().join('|')})` });
    }
    if (b.stackFrontend && getStack(b.stackFrontend)?.kind !== 'frontend') {
      return res.status(400).json({ error: `stackFrontend inválido (${listStacks('frontend').map((s) => s.id).join('|')})` });
    }
    if (b.stackBackend && getStack(b.stackBackend)?.kind !== 'backend') {
      return res.status(400).json({ error: `stackBackend inválido (${listStacks('backend').map((s) => s.id).join('|')})` });
    }

    const args = ['--idea', b.idea.trim(), '--yes'];
    if (b.scope) args.push('--scope', b.scope);
    if (b.appType) args.push('--app-type', b.appType);
    if (b.name) args.push('--name', b.name);
    if (b.arch) args.push('--arch', b.arch);
    if (b.stackFrontend) args.push('--stack-frontend', b.stackFrontend);
    if (b.stackBackend) args.push('--stack-backend', b.stackBackend);
    if (b.phone) args.push('--phone', String(b.phone));
    if (b.github) args.push('--github');
    if (b.ghpages) args.push('--ghpages');
    if (b.verifyDocker) args.push('--verify-docker');
    if (!b.github) args.push('--no-push');

    res.status(201).json({ job: addJob(args, baseDir) });
  });

  // Acciones sobre un proyecto existente.
  app.post('/api/projects/:slug/actions', async (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const dir = appDir(slug);
    const { action } = req.body ?? {};

    if (action === 'resume') {
      const args = ['--resume', slug, '--yes'];
      args.push(req.body.github ? '--github' : '--no-push');
      if (req.body.github && req.body.ghpages) args.push('--ghpages');
      return res.status(201).json({ job: addJob(args, baseDir) });
    }

    if (action === 'dockerize') {
      const variant = writeDockerFiles(dir, detectVariant(dir));
      const engine = await getEngine();
      if (!engine) {
        const state = {
          status: 'skipped',
          reason: 'ni docker ni podman están instalados',
          at: new Date().toISOString(),
        };
        writeBuildState(dir, state);
        return res.json({ variant, build: state });
      }
      return res.status(202).json({ variant, build: startBuild(dir, slug, engine) });
    }

    if (action === 'test') {
      // Corre los scripts de test de la app (npm test [+ test:e2e]) en
      // background — el resultado queda en test-run.json/test-run.log.
      const scripts = readJson(join(dir, 'package.json'))?.scripts ?? {};
      if (!scripts.test) {
        return res.status(400).json({ error: 'el proyecto no tiene script "test"' });
      }
      if (req.body.e2e && !scripts['test:e2e']) {
        return res.status(400).json({ error: 'el proyecto no tiene script "test:e2e"' });
      }
      const current = readTestState(dir);
      if (current?.status === 'running' && pidAlive(current.pid)) {
        return res.status(409).json({ error: 'ya hay un test run en curso' });
      }
      const commands = [['npm', 'test']];
      if (req.body.e2e) commands.push(['npm', 'run', 'test:e2e']);
      const label = req.body.e2e ? 'npm test + npm run test:e2e' : 'npm test';
      return res.status(202).json({ testRun: startTest(dir, commands, label) });
    }

    if (action === 'run-container') {
      const engine = await getEngine();
      if (!engine) {
        return res.status(503).json({ error: 'ni docker ni podman están instalados' });
      }
      const { containerPort, suggestedHostPort } = containerPorts(dir);
      const hostPort = req.body.port === undefined ? suggestedHostPort : Number(req.body.port);
      if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
        return res.status(400).json({ error: 'port inválido (entero 1-65535)' });
      }
      const inspect = await runCmd(`${engine} image inspect ${slug}:local`, { cwd: dir, timeoutMs: 10_000 });
      if (!inspect.ok) {
        return res.status(400).json({ error: `no hay imagen ${slug}:local — corré Dockerize primero` });
      }
      await runCmd(`${engine} rm -f ${slug}`, { timeoutMs: 10_000 }); // reemplazo idempotente
      const r = await runCmd(
        `${engine} run -d --name ${slug} -p ${hostPort}:${containerPort} ${slug}:local`,
        { cwd: dir, timeoutMs: 20_000 },
      );
      if (!r.ok) {
        return res.status(500).json({ error: r.stderr || `${engine} run falló` });
      }
      return res.status(201).json({ container: { name: slug, hostPort, containerPort, engine } });
    }

    if (action === 'stop-container') {
      const engine = await getEngine();
      if (!engine) {
        return res.status(503).json({ error: 'ni docker ni podman están instalados' });
      }
      await runCmd(`${engine} rm -f ${slug}`, { timeoutMs: 15_000 });
      return res.json({ stopped: true });
    }

    if (action === 'open-repo') {
      const remote = (await run('git remote get-url origin', { cwd: dir, timeoutMs: 5000 })).stdout.trim();
      const url = toWebUrl(remote || null);
      if (!url) return res.status(404).json({ error: 'el proyecto no tiene remote configurado' });
      return res.json({ url });
    }

    res.status(400).json({ error: 'action debe ser resume|dockerize|test|run-container|stop-container|open-repo' });
  });

  return app;
}

const main = async () => {
  const port = Number(process.env.DASHBOARD_PORT ?? 4100);
  const host = process.env.DASHBOARD_HOST ?? '127.0.0.1';
  const server = createDashboardApp().listen(port, host, () =>
    console.log(`dashboard api en http://${host}:${port}`),
  );
  // Import lazy: terminal.js carga ws (y node-pty on-demand) — si algo
  // falta, la API HTTP sigue sirviendo y solo la terminal falla.
  try {
    const { attachTerminal } = await import('./terminal.js');
    attachTerminal(server, {});
  } catch (err) {
    console.error(`terminal Devin deshabilitada: ${err.message}`);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
