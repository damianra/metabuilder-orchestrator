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

  it('comando inexistente → ok:false con stderr', async () => {
    const r = await run('comando-que-no-existe-xyz');
    expect(r.ok).toBe(false);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});
