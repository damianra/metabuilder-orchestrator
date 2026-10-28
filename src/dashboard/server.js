// API del dashboard — Express sobre la infra existente del orquestador.
//
//   npm run dashboard:api   →  http://127.0.0.1:4100
//
// Es una capa fina: lista generated-apps/ leyendo plan.json/status.json,
// encola generaciones y resumes via src/queue.js (el worker las procesa),
// y dispara docker builds locales que reportan estado en
// docker-build.json dentro de la app. Bindea a 127.0.0.1 por default —
// es una herramienta local, no un servicio expuesto.

import { appendFileSync, existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { addJob, cancelJob, clearJobs, jobsDir, readJobs, readWorker } from '../queue.js';
import { slugify } from '../tools/slug.js';
import { buildReport, resolveRunId } from '../report.js';
import { writeDockerFiles, detectFrontend, detectOutDir } from '../tools/docker.js';
import { apiSurfaceFor } from '../tools/api-surface.js';
import { listArchs } from '../arch/index.js';
import { getCompliance, listCompliance } from '../compliance/index.js';
import {
  createDesign,
  designChat,
  designDev,
  designIdleSweep,
  designStatus,
  designStopDev,
  discardDesign,
  saveDesign,
} from '../design/session.js';
import { getVertical, listVerticals } from '../verticals/index.js';
import { getStack, listStacks, resolveStacksSafe } from '../stacks/index.js';
import { getEngine as getAgentEngine, listEngines } from '../engines/index.js';
import { checkEngineAuth } from '../tools/acp.js';
import { readSettings, writeSettings } from '../tools/settings.js';
import { createRepo, getGitHubUser, getPages } from '../tools/github.js';
import { enablePagesWithRetry } from '../agents/finalizer.js';
import { publishRepo } from '../tools/publish.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const SCOPES = ['frontend', 'backend', 'fullstack'];

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// Lectura de texto plano tolerante (config git no es JSON).
const readJsonOr = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

const writeJson = (p, data) => writeFileSync(p, JSON.stringify(data, null, 2) + '\n');

// Para los writes de estado que corren en callbacks async (close del
// child, .then/.catch): si la app fue borrada a mitad de la operación
// el writeFileSync tira ENOENT — ahí es uncaught/unhandledRejection y
// tumba la API. El estado final es best-effort: se traga.
const tryWriteJson = (p, data) => {
  try {
    writeJson(p, data);
  } catch {
    /* dir borrada */
  }
};

// Ídem para el publish.log (se escribe en callbacks de promesa, fuera
// del request path — un throw sería unhandledRejection).
const tryAppendFile = (p, text) => {
  try {
    appendFileSync(p, text);
  } catch {
    /* dir borrada */
  }
};

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
  // si el archivo desaparece (app borrada a mitad de build) no queremos
  // un uncaught que tumbe toda la API.
  log.on('error', () => {});
  const child = spawn(engine, ['build', '-t', tag, '.'], { cwd: dir });
  // end:false — si stdout cierra antes que stderr, el pipe default
  // haría end() y un chunk tardío de stderr sería write-after-end.
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on('close', (exitCode) => {
    log.end();
    tryWriteJson(buildStatePath(dir), {
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
  // idem: app borrada a mitad de run → sin este handler el 'error' del
  // stream es un uncaught que tumba la API.
  log.on('error', () => {});
  log.write(`\n━━ test run · ${label} · ${state.startedAt}\n`);
  let finished = false;
  const finish = (status, exitCode) => {
    if (finished) return; // 'error' + 'close' pueden disparar ambos (ENOENT)
    finished = true;
    // El estado final se escribe cuando el log ya flusheó — así quien
    // lee status 'done'/'failed' tiene el output completo en disco.
    log.end(() =>
      tryWriteJson(testStatePath(dir), { ...state, status, exitCode, finishedAt: new Date().toISOString() }),
    );
  };
  const runNext = (i) => {
    if (i >= commands.length) return finish('done', 0);
    const [cmd, ...args] = commands[i];
    log.write(`\n$ ${[cmd, ...args].join(' ')}\n`);
    const child = spawn(cmd, args, { cwd: dir });
    state.pid = child.pid;
    tryWriteJson(testStatePath(dir), state);
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

// Publish async: publish.json en la app (mismo patrón que test-run).
// 'running' con pid muerto (dashboard caído a mitad) → stale, relanzable.
const publishPath = (dir) => join(dir, 'publish.json');
const publishLogPath = (dir) => join(dir, 'publish.log');
const readPublish = (dir) => {
  const s = readJson(publishPath(dir));
  if (s?.status === 'running' && s.pid !== process.pid && !pidAlive(s.pid)) {
    return { ...s, stale: true };
  }
  return s;
};

// --- Dev local sin containers: `npm run dev`/`npm run api` de la app ---
// Mismo patrón que startTestRun pero los procesos son de larga vida:
// estado en dev-run.json (pids por script para detectar stale), output
// en dev-run.log (stream compartido, end:false). Spawn detached →
// stop-dev mata el process group entero (npm → vite/next → hijos).
const devRunPath = (dir) => join(dir, 'dev-run.json');
const devLogPath = (dir) => join(dir, 'dev-run.log');
const readDevState = (dir) => readJson(devRunPath(dir));
const writeDevState = (dir, state) => writeJson(devRunPath(dir), state);

// Qué scripts levantar según lo que la app generada tenga: `api` →
// Express :4000; `dev` → Vite :5173 o Next :3000 según el config.
const devTargets = (dir) => {
  const scripts = readJson(join(dir, 'package.json'))?.scripts ?? {};
  const targets = [];
  if (scripts.dev) {
    const isNext = existsSync(dir) && readdirSync(dir).some((f) => /^next\.config\.(m?js|ts)$/.test(f));
    targets.push({ script: 'dev', port: isNext ? 3000 : 5173 });
  }
  if (scripts.api) targets.push({ script: 'api', port: 4000 });
  return targets;
};

export function startDevRun(dir, { spawnFn = spawn } = {}) {
  const targets = devTargets(dir);
  const state = {
    status: 'running',
    procs: targets.map((t) => ({ ...t, pid: null, alive: true })),
    startedAt: new Date().toISOString(),
  };
  writeDevState(dir, state);
  const log = createWriteStream(devLogPath(dir), { flags: 'a' });
  // stream de larga vida: si el archivo desaparece (app borrada) no
  // queremos un uncaught que tumbe toda la API.
  log.on('error', () => {});
  log.write(`\n━━ dev run · ${targets.map((t) => `npm run ${t.script}`).join(' + ')} · ${state.startedAt}\n`);
  state.procs.forEach((proc) => {
    const child = spawnFn('npm', ['run', proc.script], {
      cwd: dir,
      detached: true,
      env: process.env,
    });
    proc.pid = child.pid;
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    // El close puede llegar tarde: si stopDevRun marcó 'stopped' o ya
    // arrancó una sesión nueva (startedAt distinto), este handler NO
    // debe pisar dev-run.json — de lo contrario un stop→run rápido
    // deja el proc nuevo huérfano e incontrolable desde la UI.
    const stillCurrent = () => {
      const c = readDevState(dir);
      return c?.startedAt === state.startedAt && c.status === 'running';
    };
    child.on('close', (code) => {
      proc.alive = false;
      proc.exitCode = code ?? 1;
      const current = stillCurrent();
      if (current) tryWriteJson(devRunPath(dir), state);
      // Al morir el último proc: cerrar el stream SIEMPRE (sino cada
      // stop-dev/re-run deja un fd de dev-run.log abierto), pero el
      // estado final solo se escribe si esta sigue siendo la sesión
      // vigente.
      if (state.procs.every((p) => !p.alive)) {
        log.end(() => {
          if (current)
            tryWriteJson(devRunPath(dir), { ...state, status: 'exited', finishedAt: new Date().toISOString() });
        });
      }
    });
    child.on('error', () => {
      proc.alive = false;
      proc.exitCode = 1;
    });
  });
  writeDevState(dir, state);
  return state;
}

export function stopDevRun(dir, { killGroup = (pid) => process.kill(-pid, 'SIGTERM') } = {}) {
  const state = readDevState(dir);
  // Solo una sesión vigente: señalar procs de un run ya 'stopped'/
  // 'exited' sería SIGTERM a pids que el SO pudo reciclar (grupo ajeno).
  if (state?.status !== 'running' || !state.procs) return { stopped: false };
  for (const p of state.procs) {
    if (!p.pid || p.alive === false) continue;
    try {
      killGroup(p.pid);
    } catch {
      /* ya muerto */
    }
    p.alive = false;
  }
  writeDevState(dir, { ...state, status: 'stopped', finishedAt: new Date().toISOString() });
  return { stopped: true };
}

// devRun enriquecido: refresca alive por pid real (el JSON pudo quedar
// 'running' si el dashboard murió a mitad — mismas reglas que testRun).
const readDevRun = (dir) => {
  const s = readDevState(dir);
  if (!s) return null;
  const procs = (s.procs ?? []).map((p) => ({ ...p, alive: p.alive && pidAlive(p.pid) }));
  const live = procs.filter((p) => p.alive);
  const stale = s.status === 'running' && !live.length;
  return { ...s, procs, stale };
};

// URLs publicadas en el log del dev run — vite/next/api imprimen su
// URL real al arrancar (el puerto puede no ser el convencional si
// estaba ocupado). Se scanea el tail del log en el endpoint.
const parseDevUrls = (logText) => {
  if (!logText) return [];
  const found = new Set();
  for (const m of logText.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)\/?/g))
    found.add(`http://localhost:${m[1]}`);
  return [...found];
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
    agent: plan?.agent ?? null,
    compliance: plan?.compliance ?? null,
    status: status?.status ?? (plan ? 'unknown' : 'no-plan'),
    lastError: status?.lastError ?? null,
    steps: {
      total: steps.length,
      done: steps.filter((s) => s.status === 'done').length,
      failed: steps.filter((s) => s.status === 'failed').length,
    },
    hasDockerfile: existsSync(join(dir, 'Dockerfile')),
    // Remote sin spawnar git: .git/config siempre declara origin si existe.
    hasRemote: /\[remote "origin"\]/.test(readJsonOr(join(dir, '.git', 'config'))),
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
  startDev = startDevRun,
  stopDev = stopDevRun,
  killTerminal = () => {},
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
  // Probe de estado por engine de agente (para /api/engines y el setup
  // gate): bin en PATH + handshake ACP real. Inyectable en tests.
  agentProbe = async (engine) => {
    const bin = await runCmd(`command -v ${engine.bin}`, { timeoutMs: 10_000 });
    if (!bin.ok) return { installed: false, auth: 'missing' };
    const auth = await checkEngineAuth(engine.id, 15_000);
    return { installed: true, auth: auth.ok ? 'ok' : 'fail', detail: auth.error };
  },
  // settings.json — la escribe POST /api/settings; inyectable en tests
  // para no tocar la config real del repo.
  settingsPath = config.settingsPath,
  // REST de GitHub para el action `publish` — inyectable en tests (la
  // parte git va por runCmd). Mismas funciones que usa finalize.
  githubApi = { getUser: getGitHubUser, createRepo, enablePages: enablePagesWithRetry, getPages },
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
  const validSlug = (req, res, { requirePlan = true } = {}) => {
    const { slug } = req.params;
    const dir = appDir(slug);
    const exists = existsSync(dir) && statSync(dir).isDirectory();
    const ok = exists && (!requirePlan || existsSync(join(dir, 'plan.json')));
    if (!SLUG_RE.test(slug) || !ok) {
      res.status(404).json({ error: `proyecto "${slug}" no encontrado` });
      return null;
    }
    return slug;
  };

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Engine de agente configurado: settings.json (lo escribe el setup
  // gate) > env AGENT_PROVIDER > null (sin configurar → la UI muestra
  // el gate obligatorio y /api/runs rechaza encolar).
  const configuredEngine = () =>
    readSettings(settingsPath).engine || config.agentProvider || null;

  // Setup gate: estado de cada engine (bin + auth ACP) para que la UI
  // muestre qué está instalado/listo antes de elegir el motor.
  app.get('/api/engines', async (req, res) => {
    const engines = await Promise.all(
      listEngines().map(async (id) => {
        const e = getAgentEngine(id);
        const status = await agentProbe(e);
        return {
          id,
          label: e.label,
          bin: e.bin,
          docsUrl: e.docsUrl,
          installHint: e.installHint,
          authHint: e.authHint ?? null,
          ...status,
        };
      }),
    );
    res.json({ engine: configuredEngine(), engines });
  });

  // Persiste la elección del motor (settings.json en raíz). 'auto' es
  // válido (preflight sonda devin→opencode) aunque la UI solo ofrece
  // los dos engines concretos.
  app.post('/api/settings', async (req, res) => {
    const { engine } = req.body ?? {};
    if (engine !== 'auto' && !getAgentEngine(engine)) {
      return res
        .status(400)
        .json({ error: `engine desconocido "${engine}" (${listEngines().join('|')}|auto)` });
    }
    writeSettings({ engine }, settingsPath);
    res.json({ ok: true, engine });
  });

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
      engines: listEngines(),
      compliance: listCompliance(),
      // engine configurado (settings/env) — null = setup gate pendiente
      engine: configuredEngine(),
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
    const resume = at('--resume') ?? at('--extend');
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
    // clamp: tail=0/-3/NaN rompería slice(-lines) o devolvería todo.
    lines = Math.max(1, Math.trunc(lines) || 200);
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

  // Reintentar: re-encola los mismos args de un job terminado
  // (failed/cancelled/done) — cubre el caso "murió en preflight y no
  // dejó app" donde no hay resume posible. pending/running → 409.
  app.post('/api/jobs/:id/requeue', (req, res) => {
    const job = readJobs(baseDir).find((j) => j.id === Number(req.params.id));
    if (!job) return res.status(404).json({ error: `job ${req.params.id} no existe` });
    if (job.status === 'pending' || job.status === 'running') {
      return res.status(409).json({ error: `el job ${job.id} sigue ${job.status} — no se duplica` });
    }
    res.status(201).json({ job: addJob(job.args, baseDir) });
  });

  // Limpiar historial: borra los jobs terminados (json + log) —
  // equivalente a `npm run queue -- clear`. pending/running no se tocan.
  app.post('/api/jobs/clear', (req, res) => {
    res.json({ ok: true, removed: clearJobs(baseDir) });
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

  // Log + estado del último publish (publish.log) — mismo formato que
  // test-log/dev-log.
  app.get('/api/projects/:slug/publish-log', (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const dir = appDir(slug);
    const log = tailFile(publishLogPath(dir), { lines: Number(req.query.tail) || 200 });
    res.json({ publish: readPublish(dir), log });
  });

  // Log + estado del dev run local (dev-run.log) + URLs detectadas en
  // el output (vite/next/api imprimen su puerto real al arrancar).
  app.get('/api/projects/:slug/dev-log', (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const dir = appDir(slug);
    const log = tailFile(devLogPath(dir), { lines: Number(req.query.tail) || 200 });
    res.json({ devRun: readDevRun(dir), log, urls: parseDevUrls(log?.lines?.join('\n') ?? '') });
  });

  // Superficie de API del proyecto: el api-skeleton auto-monta cada
  // server/routes/<name>.js en /api/<name> — basta escanear los
  // archivos y capturar router.<method>('<path>').
  app.get('/api/projects/:slug/api-surface', (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    res.json({ endpoints: apiSurfaceFor(appDir(slug)) });
  });

  // Probe de un endpoint: el fetch va server-side — el browser no
  // puede llamar directo al dev-run porque el api-skeleton no emite
  // CORS. Solo paths /api/* (no es un proxy abierto).
  app.get('/api/projects/:slug/probe', async (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const path = String(req.query.path ?? '');
    if (!path.startsWith('/api/')) return res.status(400).json({ error: 'path /api/* requerido' });
    const port = devTargets(appDir(slug)).find((t) => t.script === 'api')?.port ?? 4000;
    try {
      const r = await fetch(`http://localhost:${port}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      res.json({ status: r.status, body: (await r.text()).slice(0, 4000) });
    } catch (e) {
      res.json({ status: 'ERR', body: e.message });
    }
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

  // Info del remoto del proyecto (repo + Pages) — endpoint aparte del
  // detalle porque `git ls-remote` pega en la red: la UI lo consulta
  // on-demand al montar, no en cada poll de 5s.
  app.get('/api/projects/:slug/repo', async (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const dir = appDir(slug);
    const remote = (await runCmd('git remote get-url origin', { cwd: dir, timeoutMs: 5000 })).stdout.trim();
    const repoUrl = toWebUrl(remote || null);
    let pagesUrl = null;
    if (remote) {
      const ls = await runCmd('git ls-remote --heads origin gh-pages', {
        cwd: dir,
        timeoutMs: 15_000,
      });
      const m = repoUrl?.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
      if (ls.ok && ls.stdout.trim() && m) {
        pagesUrl = `https://${m[1]}.github.io/${m[2]}/`;
      }
    }
    res.json({ repoUrl, pagesUrl });
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
      agent: plan?.agent ?? null,
      scripts: Object.entries(pkg?.scripts ?? {}).map(([name, command]) => ({ name, command })),
      repoUrl: toWebUrl(remote || null),
      report: runId ? buildReport({ runId, runDir: join(runsDir, runId), projectDir: dir }) : null,
      dockerBuild: readBuildState(dir),
      testRun: readTestRun(dir),
      publish: readPublish(dir),
      devRun: readDevRun(dir),
      devTargets: devTargets(dir),
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
    if (b.agent && b.agent !== 'auto' && !getAgentEngine(b.agent)) {
      return res.status(400).json({ error: `agent desconocido "${b.agent}" (${listEngines().join('|')}|auto)` });
    }
    if (b.compliance) {
      const ids = String(b.compliance).split(',').map((s) => s.trim()).filter(Boolean);
      const bad = ids.filter((id) => !getCompliance(id));
      if (bad.length) {
        return res.status(400).json({ error: `compliance desconocido "${bad[0]}" (${listCompliance().join('|')})` });
      }
    }
    // El gate es obligatorio: sin engine configurado (settings/env) ni
    // override por run, encolar sería tirar el job al auto por defecto.
    if (!b.agent && !configuredEngine()) {
      return res.status(400).json({
        error: 'no hay motor de agente configurado — elegí Devin u OpenCode en el setup inicial',
      });
    }

    const args = ['--idea', b.idea.trim(), '--yes'];
    if (b.scope) args.push('--scope', b.scope);
    if (b.appType) args.push('--app-type', b.appType);
    if (b.name) args.push('--name', b.name);
    if (b.arch) args.push('--arch', b.arch);
    if (b.stackFrontend) args.push('--stack-frontend', b.stackFrontend);
    if (b.stackBackend) args.push('--stack-backend', b.stackBackend);
    if (b.agent) args.push('--agent', b.agent);
    if (b.phone) args.push('--phone', String(b.phone));
    if (b.compliance) args.push('--compliance', String(b.compliance));
    if (b.github) args.push('--github');
    if (b.ghpages) args.push('--ghpages');
    if (b.verifyDocker) args.push('--verify-docker');
    if (!b.github) args.push('--no-push');

    res.status(201).json({ job: addJob(args, baseDir) });
  });

  // ---- Diseñar app: workspace + chat iterativo + preview vite ----

  app.get('/api/design', (req, res) => {
    const st = designStatus();
    // Modo attach (v10): expone el backend destino + si su api corre
    // (:4000) — la UI lo muestra como chip y habilita "probar".
    if (st.attachTo) {
      const dr = readDevRun(appDir(st.attachTo));
      st.backend = {
        slug: st.attachTo,
        apiRunning: dr?.status === 'running' && (dr.procs ?? []).some((p) => p.alive),
      };
    }
    res.json(st);
  });

  app.post('/api/design', (req, res) => {
    // for: <slug> ata el diseño a un proyecto backend — el chat lee su
    // api-surface y guardar copia el front dentro del mismo proyecto.
    const forSlug = String(req.body?.for ?? '').trim();
    if (forSlug) {
      if (!SLUG_RE.test(forSlug)) return res.status(400).json({ error: 'slug inválido (a-z0-9-)' });
      const dir = appDir(forSlug);
      const plan = readJson(join(dir, 'plan.json'));
      if (!existsSync(dir) || !plan) {
        return res.status(404).json({ error: `no existe el proyecto ${forSlug}` });
      }
      if (plan.scope !== 'backend') {
        return res.status(409).json({ error: `${forSlug} no es un proyecto backend (scope: ${plan.scope ?? '?'})` });
      }
      if (existsSync(join(dir, 'src')) || existsSync(join(dir, 'index.html'))) {
        return res.status(409).json({ error: `${forSlug} ya tiene frontend` });
      }
      if (jobs.some((j) => jobProjectSlug(j.args) === forSlug && ['pending', 'running'].includes(j.status))) {
        return res.status(409).json({ error: `${forSlug} tiene un job en curso` });
      }
    }
    const r = createDesign({ attachTo: forSlug || null });
    res.status(r.ok ? 201 : 409).json(r);
  });

  app.delete('/api/design', (req, res) => res.json(discardDesign()));

  // Chat SSE: cada data: es un chunk del agente; done/error al cerrar.
  app.post('/api/design/chat', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text requerido' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const r = await designChat(text, {
      agent: req.body?.agent ?? '',
      onChunk: (t) => send('chunk', { text: t }),
      onActivity: (a) => send('activity', { text: a }),
    });
    send(r.ok ? 'done' : 'error', r.ok ? { text: r.text } : { error: r.error });
    res.end();
  });

  app.post('/api/design/dev', (req, res) => {
    const r = designDev();
    res.status(r.ok ? 200 : 409).json(r);
  });
  app.post('/api/design/stop-dev', (req, res) => res.json(designStopDev()));

  app.post('/api/design/save', (req, res) => {
    const slug = String(req.body?.slug ?? '').trim();
    // Attach mode: el target es state.attachTo — slug del body no
    // aplica (el front se copia dentro del proyecto backend).
    const attachTo = designStatus().attachTo ?? null;
    if (!attachTo && !SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'slug inválido (a-z0-9-)' });
    }
    if (attachTo) {
      const dir = appDir(attachTo);
      if (existsSync(join(dir, 'src')) || existsSync(join(dir, 'index.html'))) {
        return res.status(409).json({ error: `${attachTo} ya tiene frontend` });
      }
      if (jobs.some((j) => jobProjectSlug(j.args) === attachTo && ['pending', 'running'].includes(j.status))) {
        return res.status(409).json({ error: `${attachTo} tiene un job en curso` });
      }
    }
    const r = saveDesign(slug);
    res.status(r.ok ? 201 : 409).json(r);
  });

  // Acciones sobre un proyecto existente.
  app.post('/api/projects/:slug/actions', async (req, res) => {
    const { action } = req.body ?? {};
    // delete no exige plan.json: un run que murió en preflight deja un
    // dir sin plan — justo lo que hay que poder limpiar desde acá.
    const slug = validSlug(req, res, { requirePlan: action !== 'delete' });
    if (!slug) return;
    const dir = appDir(slug);

    if (action === 'resume') {
      // Sin flags de deploy: el CLI restaura plan.deploy (lo que el run
      // original ya tenía). Publicar se hace aparte, con `publish`.
      return res.status(201).json({ job: addJob(['--resume', slug, '--yes'], baseDir) });
    }

    // --extend: appendea pasos backend al plan de un proyecto
    // frontend-only → el mismo job lo construye a fullstack.
    if (action === 'add-backend') {
      if (existsSync(join(dir, 'server'))) {
        return res.status(409).json({ error: 'el proyecto ya tiene backend (server/)' });
      }
      const args = ['--extend', slug, '--yes'];
      if (req.body.idea) args.push('--idea', String(req.body.idea));
      if (req.body.arch) args.push('--arch', String(req.body.arch));
      if (req.body.github) args.push('--github');
      else args.push('--no-push');
      if (req.body.ghpages && req.body.github) args.push('--ghpages');
      return res.status(201).json({ job: addJob(args, baseDir) });
    }

    // Publicar en GitHub bajo demanda (async): crea el repo si falta,
    // pushea main y — solo con ghpages:true y frontend — publica el
    // build en gh-pages + activa Pages. Estado en publish.json (la UI
    // lo lee del detalle); 409 si hay uno en curso con pid vivo.
    if (action === 'publish') {
      if (!config.githubToken) {
        return res.status(503).json({ error: 'sin GITHUB_TOKEN en .env — no se puede publicar' });
      }
      const cur = readPublish(dir);
      if (cur?.status === 'running' && !cur.stale) {
        return res.status(409).json({ error: 'ya hay un publish en curso para este proyecto' });
      }
      const plan = readJson(join(dir, 'plan.json'));
      const { frontend } = resolveStacksSafe(plan?.scope ?? 'frontend', plan?.stacks ?? {});
      const state = {
        status: 'running',
        pid: process.pid,
        ghpages: Boolean(req.body.ghpages) && Boolean(frontend),
        startedAt: new Date().toISOString(),
      };
      writeJson(publishPath(dir), state);
      publishRepo({
        dir,
        slug,
        ghpages: state.ghpages,
        buildDir: frontend?.buildDir ?? 'dist',
        pagesBaseEnv: frontend?.pagesBaseEnv ?? null,
        runCmd,
        github: githubApi,
      })
        .then((out) => {
          // Output crudo del publish → publish.log (patrón test-run.log:
          // header por run + append). Viaja en out.logText/error.logText.
          if (out.logText)
            tryAppendFile(publishLogPath(dir), `\n━━ publish · ${state.startedAt}\n${out.logText}\n`);
          tryWriteJson(publishPath(dir), {
            ...state,
            status: 'done',
            repoUrl: out.repoUrl,
            pagesUrl: out.pagesUrl,
            pagesError: out.pagesError ?? null,
            finishedAt: new Date().toISOString(),
          });
        })
        .catch((e) => {
          if (e.logText)
            tryAppendFile(publishLogPath(dir), `\n━━ publish · ${state.startedAt}\n${e.logText}\n`);
          tryWriteJson(publishPath(dir), {
            ...state,
            status: 'failed',
            error: e.message,
            finishedAt: new Date().toISOString(),
          });
        });
      return res.status(202).json(state);
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

    // Correr la app en modo dev sin containers: npm run dev (Vite/Next)
    // + npm run api (Express :4000) según los scripts del proyecto.
    if (action === 'run-dev') {
      const targets = devTargets(dir);
      if (!targets.length) {
        return res.status(400).json({ error: 'el proyecto no tiene scripts dev/api' });
      }
      const current = readDevRun(dir);
      if (current?.status === 'running' && !current.stale) {
        return res.status(409).json({ error: 'ya hay un dev run en curso' });
      }
      return res.status(202).json({ devRun: startDev(dir) });
    }

    if (action === 'stop-dev') {
      return res.json(stopDev(dir));
    }

    // Eliminar el proyecto: dir + container + imagen + sesiones vivas.
    // Rechaza si hay un job pending/running del proyecto — el worker
    // escribe dentro del dir y borrarlo debajo deja estados rotos.
    if (action === 'delete') {
      const jobs = readJobs(baseDir).filter((j) => jobProjectSlug(j.args) === slug);
      if (jobs.some((j) => j.status === 'pending' || j.status === 'running')) {
        return res.status(409).json({
          error: 'hay un job pending/running para este proyecto — cancelalo antes de borrar',
        });
      }
      stopDev(dir); // dev run vigente → process group afuera
      killTerminal(slug); // PTY Devin abierto → cerrado
      const engine = await getEngine();
      if (engine) {
        await runCmd(`${engine} rm -f ${slug}`, { timeoutMs: 15_000 });
        await runCmd(`${engine} rmi -f ${slug}:local`, { timeoutMs: 30_000 });
      }
      // Re-check antes de borrar: un POST /api/runs pudo encolar un job
      // del mismo slug durante los awaits del engine.
      const stillBusy = readJobs(baseDir).some(
        (j) => jobProjectSlug(j.args) === slug && (j.status === 'pending' || j.status === 'running'),
      );
      if (stillBusy) {
        return res.status(409).json({
          error: 'hay un job pending/running para este proyecto — cancelalo antes de borrar',
        });
      }
      rmSync(dir, { recursive: true, force: true });
      return res.json({ deleted: true, slug });
    }

    if (action === 'open-repo') {
      const remote = (await run('git remote get-url origin', { cwd: dir, timeoutMs: 5000 })).stdout.trim();
      const url = toWebUrl(remote || null);
      if (!url) return res.status(404).json({ error: 'el proyecto no tiene remote configurado' });
      return res.json({ url });
    }

    res.status(400).json({ error: 'action debe ser resume|publish|dockerize|test|run-container|stop-container|run-dev|stop-dev|delete|open-repo' });
  });

  return app;
}

const main = async () => {
  const port = Number(process.env.DASHBOARD_PORT ?? 4100);
  const host = process.env.DASHBOARD_HOST ?? '127.0.0.1';
  // La API ejecuta código arbitrario (encolar generaciones, builds,
  // kill de procesos, delete de dirs) sin auth — loopback ES la
  // frontera de seguridad. Exponerla fuera de localhost abre RCE a
  // cualquiera que alcance el puerto.
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.warn(
      `⚠ DASHBOARD_HOST=${host} expone la API fuera de localhost — ` +
        'sin auth, cualquiera en la red puede encolar generaciones y ejecutar builds',
    );
  }
  // La terminal se attachea después de crear la app — el ref deja que
  // la acción delete cierre la sesión Devin del proyecto borrado.
  const terminalRef = {};
  const server = createDashboardApp({
    killTerminal: (slug) => terminalRef.kill?.(slug),
  }).listen(port, host, () =>
    console.log(`dashboard api en http://${host}:${port}`),
  );
  // Idle-parking del preview de diseño: barre cada minuto y frena el
  // vite dev de design-work/ cuando nadie interactúa hace
  // DESIGN_IDLE_MS (la tab cerrada deja de pollear → la actividad
  // vence). unref: el timer solo no sostiene el proceso vivo.
  setInterval(() => designIdleSweep(), 60_000).unref();
  // Import lazy: terminal.js carga ws (y node-pty on-demand) — si algo
  // falta, la API HTTP sigue sirviendo y solo la terminal falla.
  try {
    const { attachTerminal } = await import('./terminal.js');
    terminalRef.kill = attachTerminal(server, {}).killBySlug;
  } catch (err) {
    console.error(`terminal Devin deshabilitada: ${err.message}`);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
