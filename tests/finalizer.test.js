import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  finalizerNode,
  ghAuthArgs,
  sanitize,
  enablePagesWithRetry,
  isWorkflowScopeError,
  httpsToSshRemote,
  pushMainWithFallback,
} from '../src/agents/finalizer.js';

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

describe('pushMainWithFallback', () => {
  const WORKFLOW_ERR =
    'refusing to allow a Personal Access Token to create or update ' +
    'workflow `.github/workflows/ci.yml` without `workflow` scope';
  const HTTPS = 'https://github.com/tester/app-x.git';

  const fakeGit = (handler) => {
    const calls = [];
    const git = async (args) => {
      calls.push(args);
      return { ok: true, stdout: '', stderr: '', ...(handler(args) ?? {}) };
    };
    return { calls, git };
  };

  it('isWorkflowScopeError detecta el rechazo por scope workflow', () => {
    expect(isWorkflowScopeError(WORKFLOW_ERR)).toBe(true);
    expect(isWorkflowScopeError('permission denied')).toBe(false);
    expect(isWorkflowScopeError(null)).toBe(false);
  });

  it('httpsToSshRemote convierte solo URLs https de github.com', () => {
    expect(httpsToSshRemote(HTTPS)).toBe('git@github.com:tester/app-x.git');
    expect(httpsToSshRemote('git@github.com:tester/app-x.git')).toBeNull();
    expect(httpsToSshRemote('https://gitlab.com/t/a.git')).toBeNull();
    expect(httpsToSshRemote(null)).toBeNull();
  });

  it('push https OK → sin fallback, una sola llamada', async () => {
    const { calls, git } = fakeGit(() => ({}));
    const r = await pushMainWithFallback(git, HTTPS, { token: 't' });
    expect(r.ok).toBe(true);
    expect(r.sshFallback).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('rechazo por scope workflow → repunta origin a SSH y reintenta', async () => {
    let pushes = 0;
    const { calls, git } = fakeGit((args) =>
      args.includes('push -u origin main') && ++pushes === 1
        ? { ok: false, stderr: WORKFLOW_ERR }
        : {},
    );
    const r = await pushMainWithFallback(git, HTTPS, { token: 't' });
    expect(r.ok).toBe(true);
    expect(r.sshFallback).toBe(true);
    expect(calls).toContain('remote add origin git@github.com:tester/app-x.git');
    expect(pushes).toBe(2);
    // el retry por SSH no lleva el extraHeader del token
    expect(calls.at(-1)).toBe('push -u origin main');
  });

  it('fallo ajeno al scope → no reintenta', async () => {
    const { calls, git } = fakeGit((args) =>
      args.includes('push -u origin main')
        ? { ok: false, stderr: 'non-fast-forward' }
        : {},
    );
    const r = await pushMainWithFallback(git, HTTPS, { token: 't' });
    expect(r.ok).toBe(false);
    expect(r.sshFallback).toBe(false);
    expect(calls.filter((c) => c.includes('push'))).toHaveLength(1);
  });

  it('scope workflow en remote no-https → no hay fallback posible', async () => {
    const { calls, git } = fakeGit((args) =>
      args.includes('push -u origin main')
        ? { ok: false, stderr: WORKFLOW_ERR }
        : {},
    );
    const r = await pushMainWithFallback(git, 'git@github.com:t/a.git', { token: 't' });
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.includes('remote add'))).toBe(false);
  });

  it('SSH también falla → stderr combina ambos errores', async () => {
    const { git } = fakeGit((args) =>
      args.includes('push -u origin main')
        ? { ok: false, stderr: args.startsWith('-c') ? WORKFLOW_ERR : 'ssh: connect refused' }
        : {},
    );
    const r = await pushMainWithFallback(git, HTTPS, { token: 't' });
    expect(r.ok).toBe(false);
    expect(r.sshFallback).toBe(false);
    expect(r.stderr).toContain('workflow');
    expect(r.stderr).toContain('connect refused');
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

  it('screenshot corre sin deployGithub — front/fullstack con build intenta capturar', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'index.html'), '<html><body>hola</body></html>');
    const r = await finalizerNode({
      projectDir: dir,
      projectSlug: 'app-shot',
      idea: 'idea',
      scope: 'frontend',
      noPush: true,
    });
    expect(r.status).toBe('done');
    // El gate abrió: hay un log de screenshot (capturado u omitido —
    // warn-only si el entorno no tiene chromium).
    expect(r.history.some((h) => h.msg.toLowerCase().includes('screenshot'))).toBe(true);

    // Backend-only nunca intenta screenshot.
    const dirB = tmp();
    const rB = await finalizerNode({
      projectDir: dirB,
      projectSlug: 'app-back',
      idea: 'idea',
      scope: 'backend',
      noPush: true,
    });
    expect(rB.history.some((h) => h.msg.toLowerCase().includes('screenshot'))).toBe(false);
  });
});
