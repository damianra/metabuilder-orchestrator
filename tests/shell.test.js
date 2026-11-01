import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { run } from '../src/tools/shell.js';

describe('run (shell)', () => {
  it('comando exitoso → ok:true con stdout', async () => {
    const r = await run('echo hola');
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hola');
  });

  it('exit code != 0 → ok:false sin lanzar', async () => {
    const r = await run('exit 3');
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(3);
  });

  it('timeout → ok:false + mensaje de timeout, nunca lanza', async () => {
    const r = await run('sleep 2', { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.stderr).toContain('excedió el timeout');
  });
  it('timeout barre el process group — nietos no quedan huérfanos', async () => {
    // 'sleep 47 & wait' genera un nieto dentro del grupo del sh -c.
    // Antes del detached el timeout mataba solo al sh y el sleep
    // quedaba vivo (PPID=1) — patrón de los dev servers huérfanos.
    const r = await run('sleep 47 & wait', { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    await new Promise((res) => setTimeout(res, 300)); // margen al kill grupal
    // '4[7]' evita que pgrep matchee el sh -c del propio execSync
    // (su cmdline contiene el literal del patrón → falso positivo).
    let alive = '';
    try {
      alive = execSync('pgrep -f "sleep 4[7]"', { encoding: 'utf8' });
    } catch { /* pgrep exit 1 → sin match */ }
    expect(alive.trim()).toBe('');
  });

  it('comando inexistente → ok:false con stderr', async () => {
    const r = await run('comando-que-no-existe-xyz');
    expect(r.ok).toBe(false);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
