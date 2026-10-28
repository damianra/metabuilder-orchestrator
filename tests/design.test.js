import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Solo asserts de lectura sobre DESIGN_DIR real (apunta a
// <repo>/design-work — create/discard podrían borrar una sesión real
// en curso). Los casos que necesitan archivos usan el param `dir` con
// un tmpdir propio.
import { DESIGN_DIR, designStatus } from '../src/design/session.js';

describe('design session', () => {
  it('designStatus responde el contrato exists/messages', () => {
    const s = designStatus();
    expect(typeof s.exists).toBe('boolean');
    expect(Array.isArray(s.messages)).toBe(true);
    if (!s.exists) expect(s.messages).toEqual([]);
  });

  it('DESIGN_DIR vive fuera de generated-apps (no aparece como proyecto)', () => {
    expect(DESIGN_DIR.endsWith('design-work')).toBe(true);
    expect(DESIGN_DIR).not.toContain('generated-apps');
  });

  it('urls solo se reportan con el dev run vivo (dev-run.json)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-design-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{}');
      // El log es append-only: la URL queda aunque el run haya parado.
      writeFileSync(join(dir, 'dev-run.log'), 'Local: http://localhost:5173/\n');
      writeFileSync(
        join(dir, 'dev-run.json'),
        JSON.stringify({ status: 'stopped', procs: [{ pid: process.pid, alive: false }] }),
      );
      const stopped = designStatus(dir);
      expect(stopped.devRunning).toBe(false);
      expect(stopped.urls).toEqual([]);
      writeFileSync(
        join(dir, 'dev-run.json'),
        JSON.stringify({ status: 'running', procs: [{ pid: process.pid, alive: true }] }),
      );
      const running = designStatus(dir);
      expect(running.devRunning).toBe(true);
      expect(running.urls).toEqual(['http://localhost:5173']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

