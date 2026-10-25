// npm run doctor — chequeo standalone de prereqs (roadmap v3 #10).
// Misma fuente de verdad que preflight (binarios + checkDevinAuth) pero
// sin encolar nada: separa "mi máquina está lista" de "el job arrancó
// y falló en preflight". Exit 1 solo si falta algo que impide generar;
// lo opcional (engine containers, playwright, GITHUB_TOKEN, node-pty)
// sale como warning.
//
// Los probes son inyectables para testear sin depender de la máquina.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';
import { run } from './tools/shell.js';
import { checkDevinAuth } from './tools/devin.js';

const ok = (name, detail = '') => ({ name, level: 'ok', detail });
const warn = (name, detail = '') => ({ name, level: 'warn', detail });
const fail = (name, detail = '') => ({ name, level: 'fail', detail });

const binVersion = async (runCmd, bin) => {
  const path = await runCmd(`command -v ${bin}`);
  if (!path.ok) return null;
  const v = await runCmd(`${bin} --version`, { timeoutMs: 10_000 });
  return v.ok ? v.stdout.trim().split('\n')[0] : 'en PATH';
};

export async function runDoctor({
  runCmd = run,
  authProbe = checkDevinAuth,
  importFn = (m) => import(m),
  home = homedir(),
  env = process.env,
  dotenvDir = config.rootDir,
} = {}) {
  const results = [];

  // Obligatorios — preflight frena el pipeline si falta cualquiera.
  for (const bin of ['node', 'npm', 'git', 'devin']) {
    const v = await binVersion(runCmd, bin);
    results.push(v ? ok(bin, v) : fail(bin, 'no está en PATH'));
  }

  // Auth Devin via ACP — el handshake real (initialize+authenticate,
  // ~1s, sin consumir slot del semáforo).
  const auth = await authProbe(15_000);
  results.push(auth.ok ? ok('devin auth (ACP)') : fail('devin auth (ACP)', auth.error ?? 'falló'));

  // Opcionales de acá en adelante — warnings, no frenan la generación.

  const pwDir = join(home, '.cache', 'ms-playwright');
  const chromium = existsSync(pwDir) && readdirSync(pwDir).some((d) => d.startsWith('chromium'));
  results.push(
    chromium
      ? ok('playwright chromium')
      : warn('playwright chromium', 'sin descargar — se instala en el primer test:e2e'),
  );

  let engine = null;
  if ((await runCmd('docker info', { timeoutMs: 10_000 })).ok) engine = 'docker';
  else if ((await runCmd('podman info', { timeoutMs: 10_000 })).ok) engine = 'podman';
  results.push(
    engine
      ? ok('container engine', engine)
      : warn('container engine', 'ni docker ni podman — dockerize/run-container no van a funcionar (run-dev sí)'),
  );

  // dotenv/config ya cargó <root>/.env en process.env.
  results.push(
    env.GITHUB_TOKEN
      ? ok('GITHUB_TOKEN', 'declarado en .env')
      : warn('GITHUB_TOKEN', 'no está en .env — --github/Pages/validate:pr no van a funcionar'),
  );

  // La terminal Devin embebida necesita el nativo; si no compila, el
  // resto del dashboard funciona igual (import lazy en server.js).
  try {
    await importFn('node-pty');
    results.push(ok('node-pty', 'terminal Devin del dashboard disponible'));
  } catch {
    results.push(warn('node-pty', 'no carga — la terminal Devin no va a abrir (el resto del dashboard funciona)'));
  }

  return results;
}

export function printResults(results, out = console.log) {
  const icon = { ok: '✓', warn: '⚠', fail: '✗' };
  for (const r of results) out(` ${icon[r.level]} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  return results;
}

export const exitCode = (results) => (results.some((r) => r.level === 'fail') ? 1 : 0);

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  console.log('\nmetabuilder doctor\n');
  const results = await runDoctor();
  printResults(results);
  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log(
    `\n${fails ? `${fails} problema(s) que impiden generar` : 'todo lo obligatorio en orden'}` +
      (warns ? ` · ${warns} warning(s) de features opcionales` : '') +
      '\n',
  );
  process.exit(exitCode(results));
}
