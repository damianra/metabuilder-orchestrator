import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { awaitInstall, isInstalling, startInstall } from '../src/tools/install.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'mb-install-'));

describe('install lazy registry', () => {
  it('sin install pendiente → awaitInstall resuelve ok', async () => {
    expect(await awaitInstall(tmp())).toEqual({ ok: true });
  });

  it('install exitoso → isInstalling transiciona y resultado se cachea', async () => {
    const dir = tmp();
    startInstall(dir, 'sleep 0.3');
    expect(isInstalling(dir)).toBe(true);
    const res = await awaitInstall(dir);
    expect(res.ok).toBe(true);
    expect(isInstalling(dir)).toBe(false);
    // segunda vez devuelve el mismo resultado cacheado
    expect((await awaitInstall(dir)).ok).toBe(true);
  });

  it('install fallido → resultado !ok queda sticky', async () => {
    const dir = tmp();
    startInstall(dir, 'exit 1');
    const res = await awaitInstall(dir);
    expect(res.ok).toBe(false);
    expect((await awaitInstall(dir)).ok).toBe(false);
  });

  it('dedup por (dir, cmd): mismo comando no repite, distinto corre en paralelo', async () => {
    const dir = tmp();
    const p1 = startInstall(dir, 'echo uno');
    const p2 = startInstall(dir, 'echo uno');
    const p3 = startInstall(dir, 'echo dos');
    expect(p1).toBe(p2);
    expect(p3).not.toBe(p1);
    // awaitInstall agrega ambos comandos del mismo dir
    expect((await awaitInstall(dir)).ok).toBe(true);
    expect(isInstalling(dir)).toBe(false);
  });

  it('multi-cmd: un install fallido ensucia el agregado con su comando', async () => {
    const dir = tmp();
    startInstall(dir, 'echo ok');
    startInstall(dir, 'echo mal && exit 3');
    const res = await awaitInstall(dir);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain('[echo mal && exit 3]');
  });
});
