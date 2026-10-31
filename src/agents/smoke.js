/**
 * Nodo `smoke` — verificación runtime pre-review (v13 #1): levanta
 * el devCmd del toolchain y pega contra los endpoints reales antes
 * del review. Corre entre `finalVerify` OK y `review`; un fallo es
 * terminal → `fail` (la severidad por DB la decide smokeApp: sqlite
 * estricto, externa warn-only). Opt-out: `--no-smoke` (canal
 * smokeEnabled) o `plan.smoke === false`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolveStacksSafe } from '../stacks/index.js';
import { smokeApp } from '../tools/smoke.js';

const stamp = (msg) => ({ ts: new Date().toISOString(), node: 'smoke', msg });
const icon = { pass: '✓', warn: '⚠', fail: '✗' };

export async function smokeNode(state, extra) {
  // LangGraph pasa RunnableConfig como 2do arg — extra.smokeApp solo
  // existe en tests que inyectan el tool.
  const run = extra?.smokeApp ?? smokeApp;
  if (state.smokeEnabled === false || state.plan?.smoke === false) {
    return { history: [stamp('skip — smoke deshabilitado (--no-smoke / plan.smoke=false)')] };
  }
  const scope = state.plan?.scope ?? state.scope ?? 'backend';
  // Safe: plan.stacks editado a mano con id inválido no debe crashear
  // el nodo — sin stacks resolubles, skip.
  const stacks = resolveStacksSafe(scope, state.plan?.stacks ?? {});
  const dir = state.projectDir;

  const results = [];
  // DB real levantable: si el proyecto trae compose con servicio de DB
  // (postgres/mysql/mongo) intentar docker compose up -d — tolerante:
  // sin docker la app puede usar driver embebido (sqljs/sqlite).
  const compose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml']
    .map((f) => join(dir, f))
    .find((f) => existsSync(f) && readFileSync(f, 'utf8').includes('db'));
  if (compose && stacks.backend) {
    try {
      await execa('docker', ['compose', 'up', '-d'], { cwd: dir, reject: false, timeout: 60_000 });
    } catch { /* sin docker — los stacks embebidos (sqljs/sqlite) siguen */ }
  }
  if (stacks.backend) {
    // Fullstack/backend: el devCmd de la API sirve también dist|out —
    // kind 'api' verifica contrato /api + SPA fallback si hay build.
    results.push({ stack: stacks.backend.id, ...(await run(dir, stacks.backend, { kind: 'api' })) });
  } else if (stacks.frontend) {
    results.push({ stack: stacks.frontend.id, ...(await run(dir, stacks.frontend, { kind: 'dev' })) });
  } else {
    return { history: [stamp('skip — sin toolchain con devCmd')] };
  }

  const checks = results.flatMap((r) => r.checks.map((c) => ({ stack: r.stack, ...c })));
  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const lines = results.map((r) =>
    r.skipped
      ? `  ${r.stack}: skip (${r.skipped})`
      : `  ${r.stack}: ${r.checks.map((c) => `${icon[c.status]} ${c.name}${c.status === 'fail' ? ` — ${c.detail}` : ''}`).join('  ')}`,
  );
  const msg = `smoke runtime\n${lines.join('\n')}`;

  if (fails.length) {
    return {
      status: 'failed',
      lastError: `smoke: ${fails.map((f) => f.name).join(', ')} falló`,
      smokeResult: { checks, warns: warns.length },
      history: [stamp(msg)],
    };
  }
  return {
    lastError: null,
    smokeResult: { checks, warns: warns.length },
    history: [stamp(msg + (warns.length ? `\n  ${warns.length} warning(s)` : ''))],
  };
}
