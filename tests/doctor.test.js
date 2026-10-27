import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exitCode, runDoctor } from '../src/doctor.js';

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

// runCmd fake: responde por contenido del comando.
const fakeRun = (bins = {}, engines = {}) => async (cmd) => {
  const m = cmd.match(/^command -v (\w+)/);
  if (m) return { ok: !!bins[m[1]], stdout: bins[m[1]] ? `/usr/bin/${m[1]}` : '', stderr: '' };
  const v = cmd.match(/^(\w+) --version/);
  if (v && bins[v[1]]) return { ok: true, stdout: `${v[1]} v1.0.0\n`, stderr: '' };
  if (cmd === 'docker info') return { ok: !!engines.docker, stdout: '', stderr: '' };
  if (cmd === 'podman info') return { ok: !!engines.podman, stdout: '', stderr: '' };
  return { ok: false, stdout: '', stderr: '' };
};

const base = (over = {}) => ({
  runCmd: fakeRun({ node: true, npm: true, git: true, devin: true }),
  authProbe: async () => ({ ok: true }),
  importFn: async () => ({}),
  home: (dir = mkdtempSync(join(tmpdir(), 'mb-doctor-'))),
  env: { GITHUB_TOKEN: 'x' },
  resolveId: () => 'devin', // engine efectivo — los tests fijan cuál es
  agentEngine: (id) => ({ id, label: id, bin: id }),
  ...over,
});

const byName = (rs) => Object.fromEntries(rs.map((r) => [r.name, r]));

describe('runDoctor', () => {
  it('máquina completa → todo ok', async () => {
    const o = base({ runCmd: fakeRun({ node: 1, npm: 1, git: 1, devin: 1, opencode: 1 }, { podman: true }) });
    mkdirSync(join(o.home, '.cache', 'ms-playwright', 'chromium-1234'), { recursive: true });
    const rs = await runDoctor(o);
    expect(rs.every((r) => r.level === 'ok')).toBe(true);
    expect(byName(rs)['container engine'].detail).toBe('podman');
    expect(exitCode(rs)).toBe(0);
  });

  it('binario devin faltante → auth ni se prueba (el spawn crashearía)', async () => {
    let probed = false;
    const rs = await runDoctor(
      base({
        runCmd: fakeRun({ node: 1, npm: 1, git: 1 }),
        authProbe: async () => {
          probed = true;
          return { ok: true };
        },
      }),
    );
    expect(probed).toBe(false); // ni devin ni opencode: sin bin no hay probe
    expect(byName(rs)['devin auth (ACP)'].level).toBe('fail');
    expect(byName(rs)['devin auth (ACP)'].detail).toContain('no está en PATH');
    expect(exitCode(rs)).toBe(1);
  });

  it('binario ok pero auth caída → fail y exit 1', async () => {
    const rs = await runDoctor(
      base({ authProbe: async () => ({ ok: false, error: 'sin credenciales' }) }),
    );
    expect(byName(rs)['devin auth (ACP)'].level).toBe('fail');
    expect(byName(rs)['devin auth (ACP)'].detail).toBe('sin credenciales');
    expect(exitCode(rs)).toBe(1);
  });

  it('opcionales ausentes → warn, no fail (exit 0)', async () => {
    const rs = await runDoctor(
      base({ env: {}, importFn: async () => { throw new Error('native fail'); } }),
    );
    expect(byName(rs)['playwright chromium'].level).toBe('warn');
    expect(byName(rs)['container engine'].level).toBe('warn');
    expect(byName(rs)['GITHUB_TOKEN'].level).toBe('warn');
    expect(byName(rs)['node-pty'].level).toBe('warn');
    expect(exitCode(rs)).toBe(0);
  });

  it('auto: solo opencode usable → devin warn, exit 0', async () => {
    const rs = await runDoctor(
      base({
        runCmd: fakeRun({ node: 1, npm: 1, git: 1, opencode: 1 }),
        authProbe: async (id) => ({ ok: id === 'opencode' }),
        resolveId: () => 'auto',
      }),
    );
    expect(byName(rs)['devin auth (ACP)'].level).toBe('warn');
    expect(byName(rs)['opencode auth (ACP)'].level).toBe('ok');
    expect(exitCode(rs)).toBe(0);
  });

  it('auto: ningún engine autentica → fail global', async () => {
    const rs = await runDoctor(
      base({
        authProbe: async () => ({ ok: false, error: 'x' }),
        resolveId: () => 'auto',
      }),
    );
    expect(byName(rs)['motor de agente'].level).toBe('fail');
    expect(exitCode(rs)).toBe(1);
  });
});
