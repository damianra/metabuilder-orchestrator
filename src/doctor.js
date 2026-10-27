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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './tools/shell.js';
import { checkEngineAuth } from './tools/acp.js';
import { getEngine, listEngines, resolveEngineId } from './engines/index.js';

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
  authProbe = (engineId, timeoutMs) => checkEngineAuth(engineId, timeoutMs),
  importFn = (m) => import(m),
  home = homedir(),
  env = process.env,
  resolveId = () => resolveEngineId(),
  agentEngine = (id) => getEngine(id), // descriptor del registry — tests lo fijan a bin literal
} = {}) {
  const results = [];

  // Obligatorios — preflight frena el pipeline si falta cualquiera.
  for (const bin of ['node', 'npm', 'git']) {
    const v = await binVersion(runCmd, bin);
    results.push(v ? ok(bin, v) : fail(bin, 'no está en PATH'));
  }

  // Engines de agente (src/engines/): se reportan todos con su probe
  // real (bin + handshake ACP), pero solo falla el engine EFECTIVO
  // (resolveEngineId: --agent > plan > settings > env > 'auto'). En
  // 'auto' basta con que uno autentique — si ninguno anda, fail global.
  const effective = resolveId();
  let anyEngineOk = false;
  for (const id of listEngines()) {
    const e = agentEngine(id);
    const v = await binVersion(runCmd, e.bin);
    const name = `${id} auth (ACP)`;
    if (!v) {
      results.push(
        effective === id
          ? fail(name, `${e.bin} no está en PATH`)
          : warn(name, `${e.bin} no está en PATH`),
      );
      continue;
    }
    const auth = await authProbe(id, 15_000);
    anyEngineOk ||= auth.ok;
    results.push(
      auth.ok
        ? ok(name, effective === 'auto' ? 'autentica (elegible por auto)' : 'autentica')
        : effective === id
          ? fail(name, auth.error ?? 'falló')
          : warn(name, auth.error ?? 'falló'),
    );
  }
  if (effective === 'auto' && !anyEngineOk) {
    results.push(
      fail(
        'motor de agente',
        'ningún engine autentica — `devin auth login` u `opencode auth login`',
      ),
    );
  } else if (effective !== 'auto' && !getEngine(effective)) {
    results.push(
      fail('motor de agente', `engine desconocido "${effective}" (${listEngines().join('|')})`),
    );
  }

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

  // dotenv/config ya cargó .env en process.env (vía config.js → cwd).
  results.push(
    env.GITHUB_TOKEN
      ? ok('GITHUB_TOKEN', 'presente en el entorno')
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

// Convención del repo (queue.js, report.js, validate-pr.js): robusta a
// paths con espacios/caracteres que import.meta.url percent-encodea.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
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
