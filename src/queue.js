// Cola serial de generaciones — un archivo por job en `jobs/` (dir
// gitignored, estado de runtime como runs/).
//
//   npm run queue -- add <args de npm start>   encola un job
//   npm run queue -- list                      estado de la cola
//   npm run queue -- clear                     borra jobs terminados
//   npm run worker                             procesa la cola en orden
//
// Un archivo por job (jobs/<id>.json) en vez de un jobs.json global:
// `add` y el worker nunca hacen read-modify-write del mismo archivo —
// no hay locking. El worker spawnea `node src/index.js <args>` por job
// con stdio heredado (los logs del pipeline se ven en vivo). El semáforo
// de sesiones Devin sigue siendo la red de seguridad para runs sueltos.
// Un job que quedó `running` al arrancar el worker = el worker anterior
// murió a mitad → se marca `failed` (la app se retoma con --resume).

import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

export const jobsDir = (baseDir = config.rootDir) => join(baseDir, 'jobs');
const jobPath = (id, baseDir) => join(jobsDir(baseDir), `${id}.json`);

// tmp + rename: un crash a mitad de write no deja un archivo corrupto.
const writeJob = (job, baseDir = config.rootDir) => {
  mkdirSync(jobsDir(baseDir), { recursive: true });
  const tmp = `${jobPath(job.id, baseDir)}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(job, null, 2) + '\n');
  renameSync(tmp, jobPath(job.id, baseDir));
};

export function readJobs(baseDir = config.rootDir) {
  const dir = jobsDir(baseDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
}

// 'wx' = crear exclusivo: si dos `add` concurrentes eligen el mismo id,
// el segundo reintenta con el siguiente — nunca pisa un job ajeno.
export function addJob(args, baseDir = config.rootDir) {
  mkdirSync(jobsDir(baseDir), { recursive: true });
  let id = readJobs(baseDir).reduce((m, j) => Math.max(m, j.id), 0) + 1;
  const job = {
    id,
    args,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  for (;;) {
    try {
      const fd = openSync(`${jobPath(id, baseDir)}.new`, 'wx');
      closeSync(fd);
      writeFileSync(`${jobPath(id, baseDir)}.new`, JSON.stringify({ ...job, id }, null, 2) + '\n');
      renameSync(`${jobPath(id, baseDir)}.new`, jobPath(id, baseDir));
      return { ...job, id };
    } catch {
      id++;
    }
  }
}

// Corre un job: spawn del pipeline como subproceso. `cmd` es
// parametrizable para tests (default: el CLI real).
export async function runJob(
  job,
  { baseDir = config.rootDir, cmd = [process.execPath, join(config.rootDir, 'src/index.js')] } = {},
) {
  writeJob({ ...job, status: 'running', startedAt: new Date().toISOString() }, baseDir);

  const exitCode = await new Promise((resolveCode) => {
    const child = spawn(cmd[0], [...cmd.slice(1), ...job.args], {
      cwd: config.rootDir,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => resolveCode(code ?? 1));
    child.on('error', () => resolveCode(1));
  });

  const done = exitCode === 0;
  writeJob(
    { ...job, status: done ? 'done' : 'failed', finishedAt: new Date().toISOString(), exitCode },
    baseDir,
  );
  return done;
}

// Procesa todos los jobs pendientes en orden de id. Devuelve cuántos
// terminaron en done.
export async function runQueue(opts = {}) {
  const baseDir = opts.baseDir ?? config.rootDir;
  // Jobs que quedaron 'running': el worker anterior murió a mitad.
  for (const j of readJobs(baseDir).filter((j) => j.status === 'running')) {
    writeJob({ ...j, status: 'failed', note: 'worker murió a mitad — retomar con --resume' }, baseDir);
  }

  let done = 0;
  for (;;) {
    const next = readJobs(baseDir).find((j) => j.status === 'pending');
    if (!next) return done;
    console.log(`\n━━ job #${next.id} → node src/index.js ${next.args.join(' ')}`);
    if (await runJob(next, { ...opts, baseDir })) {
      done++;
    } else {
      console.error(`   ✗ job #${next.id} falló`);
    }
  }
}

const fmtJob = (j) =>
  `  #${j.id} ${j.status.padEnd(8)} ${j.exitCode !== undefined ? `exit:${j.exitCode} ` : ''}${j.args.join(' ')}${j.note ? `  (${j.note})` : ''}`;

const main = async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'add': {
      if (!rest.includes('--idea') && !rest.includes('--resume')) {
        console.error(
          'uso: npm run queue -- add --idea "..." [--scope ...] (los args son los de npm start)',
        );
        process.exit(1);
      }
      const job = addJob(rest);
      console.log(`✔ job #${job.id} encolado: ${rest.join(' ')}`);
      break;
    }
    case 'list': {
      const jobs = readJobs();
      console.log(jobs.length ? jobs.map(fmtJob).join('\n') : 'cola vacía');
      break;
    }
    case 'clear': {
      const jobs = readJobs();
      const keep = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
      for (const j of jobs.filter((j) => !keep.includes(j))) {
        rmSync(jobPath(j.id), { force: true });
      }
      console.log(`✔ ${jobs.length - keep.length} jobs terminados borrados`);
      break;
    }
    case 'run': {
      const done = await runQueue();
      console.log(`\n✔ cola procesada — ${done} job(s) en done`);
      break;
    }
    default:
      console.error('uso: npm run queue -- add|list|clear|run …   (run = npm run worker)');
      process.exit(1);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
