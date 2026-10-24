import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildReport,
  collectSessions,
  resolveRunId,
  slugFromRunId,
} from '../src/report.js';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mb-report-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const RUN = '2026-10-24T01-00-00-000Z-mi-app';
const mkRun = () => {
  const runDir = join(dir, RUN, 'prompts');
  mkdirSync(runDir, { recursive: true });
  return join(dir, RUN);
};

describe('slugFromRunId', () => {
  it('quita el prefijo timestamp y el sufijo -resume', () => {
    expect(slugFromRunId(RUN)).toBe('mi-app');
    expect(slugFromRunId(`${RUN}-resume`)).toBe('mi-app');
  });
});

describe('resolveRunId', () => {
  it('acepta runId exacto o slug (el más reciente)', () => {
    mkdirSync(join(dir, RUN), { recursive: true });
    mkdirSync(join(dir, '2026-10-25T01-00-00-000Z-mi-app'), { recursive: true });
    expect(resolveRunId(RUN, dir)).toBe(RUN);
    // sorted desc → el de 10-25 es el más reciente para el slug.
    expect(resolveRunId('mi-app', dir)).toBe('2026-10-25T01-00-00-000Z-mi-app');
    expect(resolveRunId('nope', dir)).toBe(null);
  });
});

describe('collectSessions', () => {
  it('resume duración, prompts y bytes por archivo rpc', () => {
    const runDir = mkRun();
    const f = join(runDir, 'prompts', 'build-1.rpc.jsonl');
    writeFileSync(f, '[client→] {"method":"session/prompt"}\n[client→] {"method":"session/new"}\n');
    const t0 = new Date('2026-10-24T01:00:00Z');
    const t1 = new Date('2026-10-24T01:02:30Z');
    utimesSync(f, t0, t1); // atime, mtime — birthtime queda de la creación
    const [s] = collectSessions(runDir);
    expect(s.name).toBe('build-1');
    expect(s.prompts).toBe(1);
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sin prompts/ → lista vacía', () => {
    expect(collectSessions(join(dir, 'nada'))).toEqual([]);
  });
});

describe('buildReport', () => {
  it('agrega status, plan y sesiones en markdown', () => {
    const runDir = mkRun();
    writeFileSync(join(runDir, 'prompts', 'review.rpc.jsonl'), '{"method":"session/prompt"}\n');
    writeFileSync(join(runDir, 'prompts', 'fix-2-1.rpc.jsonl'), '{"method":"session/prompt"}\n');

    const appDir = join(dir, 'app');
    mkdirSync(appDir);
    writeFileSync(
      join(appDir, 'status.json'),
      JSON.stringify({ status: 'done', elapsedMs: 125_000, lastError: null }),
    );
    writeFileSync(
      join(appDir, 'plan.json'),
      JSON.stringify({
        projectName: 'mi-app',
        appType: 'orders',
        scope: 'fullstack',
        steps: [
          { id: 1, type: 'infra', status: 'done', attempts: 0, verify: 'npm run build' },
          { id: 2, type: 'backend', status: 'done', attempts: 2, verify: 'npx vitest run' },
        ],
      }),
    );

    const md = buildReport({ runId: RUN, runDir, projectDir: appDir });
    expect(md).toContain('**duración total**: 2m 5s');
    expect(md).toContain('vertical=orders');
    expect(md).toContain('| 2 | backend | done | 2 |');
    expect(md).toContain('Sesiones Devin (2)');
    expect(md).toContain('2 intento(s) de paso · 1 sesión(es) de fix');
  });

  it('status.json viejo sin elapsedMs → deriva duración del runId→ts', () => {
    const runDir = mkRun();
    const appDir = join(dir, 'app');
    mkdirSync(appDir);
    // runId arranca 01:00:00, status.ts 01:10:00 → 10m derivados.
    writeFileSync(
      join(appDir, 'status.json'),
      JSON.stringify({ status: 'done', ts: '2026-10-24T01:10:00.000Z' }),
    );
    const md = buildReport({ runId: RUN, runDir, projectDir: appDir });
    expect(md).toContain('**duración total**: 10m 0s');
  });
});
