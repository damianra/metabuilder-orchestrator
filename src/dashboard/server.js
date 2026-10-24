// API del dashboard — Express sobre la infra existente del orquestador.
//
//   npm run dashboard:api   →  http://127.0.0.1:4100
//
// Es una capa fina: lista generated-apps/ leyendo plan.json/status.json,
// encola generaciones y resumes via src/queue.js (el worker las procesa),
// y dispara docker builds locales que reportan estado en
// docker-build.json dentro de la app. Bindea a 127.0.0.1 por default —
// es una herramienta local, no un servicio expuesto.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { addJob, readJobs, readWorker } from '../queue.js';
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
export function startDockerBuild(dir, slug) {
  const tag = `${slug}:local`;
  const state = { status: 'running', tag, startedAt: new Date().toISOString() };
  writeBuildState(dir, state);
  const log = createWriteStream(join(dir, 'docker-build.log'), { flags: 'a' });
  const child = spawn('docker', ['build', '-t', tag, '.'], { cwd: dir });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
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

async function dockerAvailable() {
  return (await run('docker info', { timeoutMs: 15_000 })).ok;
}

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

/**
 * App Express del dashboard. Deps inyectables para tests:
 * appsDir/runsDir/baseDir (jobs/), dockerProbe y startBuild (el build
 * real solo corre si hay daemon — en tests se inyecta un fake).
 */
export function createDashboardApp({
  appsDir = config.generatedAppsDir,
  runsDir = config.runsDir,
  baseDir = config.rootDir,
  dockerProbe = dockerAvailable,
  startBuild = startDockerBuild,
} = {}) {
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
    const base = slugify(at('--name') ?? at('--idea') ?? '');
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

  app.get('/api/projects/:slug', async (req, res) => {
    const slug = validSlug(req, res);
    if (!slug) return;
    const dir = appDir(slug);
    const plan = readJson(join(dir, 'plan.json'));
    const summary = projectSummary(dir, slug);
    const runId = resolveRunId(slug, runsDir);
    const remote = (await run('git remote get-url origin', { cwd: dir, timeoutMs: 5000 })).stdout.trim();
    res.json({
      ...summary,
      idea: plan?.idea ?? null,
      planSteps: plan?.steps ?? [],
      validated: plan?.validated ?? false,
      repoUrl: toWebUrl(remote || null),
      report: runId ? buildReport({ runId, runDir: join(runsDir, runId), projectDir: dir }) : null,
      dockerBuild: readBuildState(dir),
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
      if (!(await dockerProbe())) {
        const state = {
          status: 'skipped',
          reason: 'docker daemon no disponible',
          at: new Date().toISOString(),
        };
        writeBuildState(dir, state);
        return res.json({ variant, build: state });
      }
      return res.status(202).json({ variant, build: startBuild(dir, slug) });
    }

    if (action === 'open-repo') {
      const remote = (await run('git remote get-url origin', { cwd: dir, timeoutMs: 5000 })).stdout.trim();
      const url = toWebUrl(remote || null);
      if (!url) return res.status(404).json({ error: 'el proyecto no tiene remote configurado' });
      return res.json({ url });
    }

    res.status(400).json({ error: 'action debe ser resume|dockerize|open-repo' });
  });

  return app;
}

const main = () => {
  const port = Number(process.env.DASHBOARD_PORT ?? 4100);
  const host = process.env.DASHBOARD_HOST ?? '127.0.0.1';
  createDashboardApp().listen(port, host, () =>
    console.log(`dashboard api en http://${host}:${port}`),
  );
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
