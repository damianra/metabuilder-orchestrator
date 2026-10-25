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
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { finished } from 'node:stream/promises';
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

export function readJob(id, baseDir = config.rootDir) {
  try {
    return JSON.parse(readFileSync(jobPath(id, baseDir), 'utf8'));
  } catch {
    return null;
  }
}

// Cancelación: pending → 'cancelled' inmediato (el worker solo consume
// pending, así que nunca arranca). running → flag `cancelRequested` en
// el JSON; el watcher de runJob lo ve y mata el árbol del subproceso
// (spawn detached → kill(-pid) cubre npm/node/devin acp). La API no
// mata directo: el dueño del child es el worker.
export function cancelJob(id, baseDir = config.rootDir) {
  const job = readJob(id, baseDir);
  if (!job) return { ok: false, error: `job #${id} no existe` };
  if (job.status === 'pending') {
    writeJob(
      { ...job, status: 'cancelled', finishedAt: new Date().toISOString() },
      baseDir,
    );
    return { ok: true, status: 'cancelled' };
  }
  if (job.status === 'running') {
    writeJob({ ...job, cancelRequested: true }, baseDir);
    return { ok: true, status: 'cancelling' };
  }
  return { ok: false, error: `job #${id} ya terminó (${job.status})` };
}

// Hard link como create-exclusivo atómico: linkSync falla EEXIST si el
// destino ya existe — sin la ventana que tendría wx sobre un archivo
// temporal (que al renombrarse libera el nombre temporal y permite que
// otro add pise el destino). Solo se reintenta en EEXIST; otros errores
// (ENOSPC, EACCES) propagan — un loop ciego sería infinito.
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
    const tmp = `${jobPath(id, baseDir)}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify({ ...job, id }, null, 2) + '\n');
      linkSync(tmp, jobPath(id, baseDir));
      rmSync(tmp);
      return { ...job, id };
    } catch (err) {
      rmSync(tmp, { force: true });
      if (err.code !== 'EEXIST') throw err;
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
  // Re-check: pudo ser cancelado entre el find() de runQueue y acá.
  if (readJob(job.id, baseDir)?.status !== 'pending') return 'cancelled';

  const startedAt = new Date().toISOString();
  writeJob({ ...job, status: 'running', startedAt }, baseDir);

  // El output del pipeline se tee-ea a jobs/<id>.log — el dashboard lo
  // sirve por GET /api/jobs/:id/log (stdio 'inherit' lo perdía todo).
  const logStream = createWriteStream(
    jobPath(job.id, baseDir).replace(/\.json$/, '.log'),
    { flags: 'a' },
  );
  logStream.write(`\n━━ job #${job.id} · ${startedAt} · ${job.args.join(' ')}\n`);

  let childPid = null;
  const exitCode = await new Promise((resolveCode) => {
    const child = spawn(cmd[0], [...cmd.slice(1), ...job.args], {
      cwd: config.rootDir,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
      // detached → process group propio: kill(-pid) mata el árbol
      // entero (node → npm → devin acp → nietos) al cancelar.
      detached: true,
    });
    // Persistir el pid — referencia para debugging/operación externa.
    childPid = child.pid;
    writeJob({ ...job, status: 'running', startedAt, pid: childPid }, baseDir);

    // Watcher de cancelRequested: el API solo escribe el flag; acá se
    // ejecuta el kill (somos dueños del child). SIGTERM al grupo y
    // SIGKILL de escalación si no murió en 4s.
    let killedAt = 0;
    const cancelWatch = setInterval(() => {
      if (!readJob(job.id, baseDir)?.cancelRequested) return;
      if (!killedAt) {
        killedAt = Date.now();
        logStream.write('\n━━ cancelación solicitada — matando el run\n');
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* ya murió */
        }
      } else if (Date.now() - killedAt > 4000) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* ya murió */
        }
      }
    }, 500);
    cancelWatch.unref?.();

    child.stdout.on('data', (d) => {
      process.stdout.write(d);
      logStream.write(d);
    });
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      logStream.write(d);
    });
    child.on('close', (code) => {
      clearInterval(cancelWatch);
      logStream.end();
      resolveCode(code ?? 1);
    });
    child.on('error', () => {
      clearInterval(cancelWatch);
      logStream.end();
      resolveCode(1);
    });
  });

  // El close del child no garantiza que el log ya flusheó a disco —
  // sin el await, quien lee <id>.log apenas termina runJob puede verlo
  // vacío/incompleto (flaky en CI).
  await finished(logStream).catch(() => {});

  // Re-leer: el flag pudo llegar mientras corría.
  const cancelled = Boolean(readJob(job.id, baseDir)?.cancelRequested);
  const status = cancelled ? 'cancelled' : exitCode === 0 ? 'done' : 'failed';
  writeJob(
    {
      ...job,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      pid: childPid,
      ...(cancelled ? { note: 'cancelado por el usuario' } : {}),
    },
    baseDir,
  );
  return status;
}

// Heartbeat del worker: jobs/.worker {pid, ts} — el dashboard lo lee
// para mostrar "sin worker consumiendo" cuando hay jobs pendientes.
const workerPath = (baseDir = config.rootDir) => join(jobsDir(baseDir), '.worker');

export function writeHeartbeat(baseDir = config.rootDir) {
  mkdirSync(jobsDir(baseDir), { recursive: true });
  writeFileSync(workerPath(baseDir), JSON.stringify({ pid: process.pid, ts: Date.now() }) + '\n');
}

// alive = heartbeat fresco (<15s) Y proceso vivo (kill(pid,0) —
// ESRCH muere, EPERM cuenta como vivo).
export function readWorker(baseDir = config.rootDir) {
  try {
    const { pid, ts } = JSON.parse(readFileSync(workerPath(baseDir), 'utf8'));
    let alive = Date.now() - ts <= 15_000;
    if (alive) {
      try {
        process.kill(pid, 0);
      } catch (e) {
        alive = e.code === 'EPERM';
      }
    }
    return { alive, pid, ts };
  } catch {
    return { alive: false, pid: null, ts: null };
  }
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
    const status = await runJob(next, { ...opts, baseDir });
    if (status === 'done') done++;
    else if (status === 'cancelled') console.log(`   ◌ job #${next.id} cancelado`);
    else console.error(`   ✗ job #${next.id} falló`);
  }
}

// Modo daemon: procesa la cola en loop con heartbeat — es el worker
// que `npm run dashboard` levanta para que los jobs no queden
// pending esperando un consumidor.
export async function watchQueue({ intervalMs = 1500, baseDir = config.rootDir } = {}) {
  writeHeartbeat(baseDir);
  const hb = setInterval(() => writeHeartbeat(baseDir), 1000);
  hb.unref?.();
  for (;;) {
    await runQueue({ baseDir });
    await new Promise((r) => setTimeout(r, intervalMs));
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
    case 'cancel': {
      const id = Number(rest[0]);
      const res = Number.isInteger(id) ? cancelJob(id) : { ok: false, error: 'uso: cancel <id>' };
      console.log(res.ok ? `✔ job #${id} → ${res.status}` : `✗ ${res.error}`);
      if (!res.ok) process.exitCode = 1;
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
        rmSync(jobPath(j.id).replace(/\.json$/, '.log'), { force: true });
      }
      console.log(`✔ ${jobs.length - keep.length} jobs terminados borrados`);
      break;
    }
    case 'run': {
      const done = await runQueue();
      console.log(`\n✔ cola procesada — ${done} job(s) en done`);
      break;
    }
    case 'watch': {
      console.log('worker en watch — consumiendo la cola en loop (Ctrl+C para salir)');
      await watchQueue();
      break;
    }
    default:
      console.error('uso: npm run queue -- add|list|cancel <id>|clear|run|watch …   (run = npm run worker)');
      process.exit(1);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
