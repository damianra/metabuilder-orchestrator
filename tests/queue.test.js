import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addJob, readJobs, runJob, runQueue } from '../src/queue.js';

// baseDir aislado por test; el hijo es un script fixture (no `-e`:
// `node -e 's' --idea` parsearía --idea como flag de node, no como
// argv del script). Nada toca Devin ni el pipeline real.

const child = fileURLToPath(new URL('./fixtures/queue-child.mjs', import.meta.url));
const cmd = [process.execPath, child];

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mb-queue-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const putJob = (job) => {
  mkdirSync(join(dir, 'jobs'), { recursive: true });
  writeFileSync(join(dir, 'jobs', `${job.id}.json`), JSON.stringify(job));
};

describe('cola de jobs', () => {
  it('addJob asigna ids crecientes y persiste', () => {
    const a = addJob(['--idea', 'uno'], dir);
    const b = addJob(['--idea', 'dos'], dir);
    expect([a.id, b.id]).toEqual([1, 2]);
    const jobs = readJobs(dir);
    expect(jobs.map((j) => j.status)).toEqual(['pending', 'pending']);
    expect(jobs[1].args).toEqual(['--idea', 'dos']);
  });

  it('addJob salta ids ya ocupados (EEXIST) — nunca pisa un job ajeno', () => {
    putJob({ id: 1, args: ['--idea', 'ocupado'], status: 'pending' });
    const job = addJob(['--idea', 'nuevo'], dir);
    expect(job.id).toBe(2);
    // El job pre-existente quedó intacto.
    expect(readJobs(dir).find((j) => j.id === 1).args).toEqual(['--idea', 'ocupado']);
  });

  it('runJob marca done con exitCode 0', async () => {
    const job = addJob(['--idea', 'x'], dir);
    expect(await runJob(job, { baseDir: dir, cmd })).toBe(true);
    const j = readJobs(dir)[0];
    expect(j.status).toBe('done');
    expect(j.exitCode).toBe(0);
    expect(j.finishedAt).toBeTruthy();
  });

  it('runJob marca failed con exitCode del subproceso', async () => {
    const job = addJob(['--idea', 'malo'], dir);
    expect(await runJob(job, { baseDir: dir, cmd })).toBe(false);
    const j = readJobs(dir)[0];
    expect(j.status).toBe('failed');
    expect(j.exitCode).toBe(3);
  });

  it('runQueue procesa pendientes en orden y para en la cola vacía', async () => {
    addJob(['--idea', 'a'], dir);
    addJob(['--idea', 'b'], dir);
    putJob({ id: 0, args: ['--idea', 'viejo'], status: 'done' });
    expect(await runQueue({ baseDir: dir, cmd })).toBe(2);
    expect(readJobs(dir).map((j) => j.status)).toEqual(['done', 'done', 'done']);
  });

  it('jobs running al arrancar (worker muerto) → failed + nota de resume', async () => {
    putJob({ id: 7, args: ['--idea', 'x'], status: 'running' });
    await runQueue({ baseDir: dir, cmd });
    const j = readJobs(dir)[0];
    expect(j.status).toBe('failed');
    expect(j.note).toContain('--resume');
  });

  it('un job que falla no frena a los siguientes', async () => {
    addJob(['--idea', 'malo'], dir);
    addJob(['--idea', 'bueno'], dir);
    expect(await runQueue({ baseDir: dir, cmd })).toBe(1);
    expect(readJobs(dir).map((j) => j.status)).toEqual(['failed', 'done']);
  });
});

describe('heartbeat del worker', () => {
  it('writeHeartbeat → readWorker vivo con pid propio', async () => {
    const { writeHeartbeat, readWorker } = await import('../src/queue.js');
    writeHeartbeat(dir);
    const w = readWorker(dir);
    expect(w.alive).toBe(true);
    expect(w.pid).toBe(process.pid);
  });

  it('sin archivo o heartbeat viejo → alive false', async () => {
    const { readWorker } = await import('../src/queue.js');
    expect(readWorker(dir).alive).toBe(false);
    // Stale: ts viejo con pid vivo → muerto igual.
    const { writeHeartbeat } = await import('../src/queue.js');
    writeHeartbeat(dir);
    const p = join(dir, 'jobs', '.worker');
    const hb = JSON.parse(readFileSync(p, 'utf8'));
    hb.ts = Date.now() - 60_000;
    writeFileSync(p, JSON.stringify(hb));
    expect(readWorker(dir).alive).toBe(false);
  });
});
