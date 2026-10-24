import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { finalizerNode, ghAuthArgs, sanitize, enablePagesWithRetry } from '../src/agents/finalizer.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'mb-fin-'));

describe('ghAuthArgs', () => {
  it('header Basic base64(x-access-token:TOKEN) para github.com', () => {
    const args = ghAuthArgs('token-falso-123');
    expect(args).toContain('http.https://github.com.extraHeader');
    const b64 = args.match(/Basic ([A-Za-z0-9+/=]+)/)?.[1];
    expect(Buffer.from(b64, 'base64').toString()).toBe('x-access-token:token-falso-123');
  });

  it('sin token → string vacío', () => {
    expect(ghAuthArgs('')).toBe('');
  });
});

describe('sanitize', () => {
  it('reemplaza el token por *** en cualquier salida', () => {
    expect(sanitize('error: auth token-falso-123 invalid', 'token-falso-123')).toBe(
      'error: auth *** invalid',
    );
    expect(sanitize('sin token', '')).toBe('sin token');
  });
});

describe('enablePagesWithRetry', () => {
  const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  const opts = { delayMs: 0, enable: null };

  it('éxito al primer intento → no reintenta', async () => {
    let calls = 0;
    const enable = async () => (++calls, { html_url: 'https://x.github.io/y/' });
    const r = await enablePagesWithRetry('t', 'o', 'r', { ...opts, enable });
    expect(r.html_url).toContain('github.io');
    expect(calls).toBe(1);
  });

  it('500 transitorio → reintenta hasta éxito', async () => {
    let calls = 0;
    const enable = async () => (++calls === 2 ? { html_url: 'u' } : Promise.reject(err(500)));
    const r = await enablePagesWithRetry('t', 'o', 'r', { ...opts, enable });
    expect(r.html_url).toBe('u');
    expect(calls).toBe(2);
  });

  it('500 persistente → agota retries y lanza', async () => {
    let calls = 0;
    const enable = async () => (++calls, Promise.reject(err(500)));
    await expect(
      enablePagesWithRetry('t', 'o', 'r', { retries: 2, delayMs: 0, enable }),
    ).rejects.toThrow('HTTP 500');
    expect(calls).toBe(3); // intento inicial + 2 retries
  });

  it('409 "already enabled" → no reintenta, lanza directo', async () => {
    let calls = 0;
    const enable = async () => (++calls, Promise.reject(err(409)));
    await expect(
      enablePagesWithRetry('t', 'o', 'r', { retries: 3, delayMs: 0, enable }),
    ).rejects.toThrow('HTTP 409');
    expect(calls).toBe(1);
  });
});

describe('finalizerNode — commit idempotente', () => {
  it('dos corridas producen un solo commit', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'archivo.txt'), 'contenido');
    const state = {
      projectDir: dir,
      projectSlug: 'app-test',
      idea: 'idea de prueba',
      scope: 'fullstack',
      noPush: true,
    };

    const r1 = await finalizerNode(state);
    expect(r1.status).toBe('done');
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('app-test');

    const r2 = await finalizerNode(state);
    expect(r2.status).toBe('done');
    expect(r2.history.some((h) => h.msg.includes('reutilizado'))).toBe(true);

    const count = execSync('git rev-list --count HEAD', { cwd: dir }).toString().trim();
    expect(count).toBe('1');
  });
});
