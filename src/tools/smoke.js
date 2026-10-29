/**
 * Smoke runtime post-build (v13 #1): levanta el `devCmd` del toolchain
 * del stack, espera el puerto y verifica el contrato HTTP de la app
 * generada — `/api/health` 200, rutas GET del api-surface, 404 JSON en
 * `/api/*` no-GET/desconocidas y SPA fallback si hay `dist/`/`out/`.
 *
 * Regla del workflow: la validación nunca depende de servicios o
 * credenciales externas — con DB externa (postgres/mysql/mongo) un
 * endpoint que responde 5xx es 'warn' (la ruta existe, la data no se
 * exige) y un boot que no levanta es skip+warn (sin .env real no se
 * puede distinguir app rota de credenciales ausentes). Con DB embebida
 * (sqlite) todo es estricto: el smoke falla → el run falla.
 *
 * Deps inyectables para tests (spawnFn/fetchFn/sleepFn/killGroup).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiSurfaceFor, apiSurfaceKindOf } from './api-surface.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readEnv = (dir, key) => {
  try {
    const src = readFileSync(join(dir, '.env'), 'utf8');
    return src.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
};

// DB embebida → exigencia completa. express-sqlite siempre; fastapi
// resuelve por DATABASE_URL del .env (sqlite es el default — sin .env
// también es embebida).
export const isEmbeddedDb = (dir, stack) => {
  if (!stack) return false;
  if (stack.id === 'express-sqlite') return true;
  if (stack.framework === 'fastapi' && stack.dbs?.includes('sqlite')) {
    return (readEnv(dir, 'DATABASE_URL') ?? 'sqlite').startsWith('sqlite');
  }
  return false;
};

const hasSpaBuild = (dir) =>
  ['dist', 'out'].some((d) => existsSync(join(dir, d, 'index.html')));

/**
 * Corre el smoke contra `dir` levantando `stack.toolchain.devCmd`.
 * `kind`: 'api' (backend/fullstack — contrato /api + SPA) o 'dev'
 * (frontend-only — GET / 200). Devuelve {ok, strict, checks, skipped}
 * — checks: [{name, status:'pass'|'fail'|'warn', detail}].
 */
export async function smokeApp(dir, stack, {
  kind = 'api',
  spawnFn = spawn,
  fetchFn = globalThis.fetch?.bind(globalThis),
  sleepFn = sleep,
  timeoutMs = 30_000,
  killGroup = (pid) => process.kill(-pid, 'SIGTERM'),
} = {}) {
  const t = stack?.toolchain;
  const checks = [];
  const strict = kind === 'api' ? isEmbeddedDb(dir, stack) : true;
  const add = (name, status, detail = '') => checks.push({ name, status, detail });
  const mark = (name, ok, detail, { warnable = false } = {}) =>
    add(name, ok ? 'pass' : warnable ? 'warn' : 'fail', detail);

  if (!t?.devCmd || !t.devPort) {
    return { ok: true, strict, checks, skipped: `stack ${stack?.id ?? '?'} sin devCmd` };
  }

  const base = `http://127.0.0.1:${t.devPort}`;
  const get = async (path) => {
    try {
      // Timeout corto: un endpoint colgado no debe comer el deadline.
      const res = await fetchFn(base + path, { signal: AbortSignal.timeout(5_000) });
      return { status: res.status };
    } catch (e) {
      return { status: null, error: e?.message ?? 'conn error' };
    }
  };

  // Puerto ocupado por otro proceso antes de spawnar → no podemos
  // distinguir nuestro server del ajeno: skip seguro (nunca FAIL por
  // EADDRINUSE ni pass por un server que no es el de la app).
  const pre = await get(kind === 'api' ? '/api/health' : '/');
  if (pre.status !== null) {
    return { ok: true, strict, checks, skipped: `puerto ${t.devPort} ocupado — smoke sin ambiente aislado` };
  }

  // Spawn detached — el kill va al process group (npm → hijos), mismo
  // patrón que startDevRun del dashboard. Si el bin no existe (ej.
  // uvicorn instalado fuera del PATH del usuario), un retry con
  // `python3 -m uvicorn` salva el caso fastapi.
  let [bin, ...args] = t.devCmd.split(/\s+/);
  let child, tail = '';
  let died = null;
  const launch = () => {
    // PORT forzado al devPort del toolchain: un PORT ambiental del
    // host (CI/containers) haría levantar la app en otro puerto y el
    // smoke sondearía el suyo → boot-fail espurio terminal. Vite lo
    // ignora, express/nest/next lo honran, uvicorn va por --port.
    child = spawnFn(bin, args, { cwd: dir, detached: true, env: { ...process.env, PORT: String(t.devPort) } });
    child.stdout?.on('data', (d) => { tail = (tail + d).slice(-4096); });
    child.stderr?.on('data', (d) => { tail = (tail + d).slice(-4096); });
    // ENOENT emite error→died=127 y DESPUÉS close con code -2 — no
    // pisar died si error ya lo marcó (sino el retry de uvicorn
    // queda muerto: 127 → -2 antes del check).
    child.on('error', () => { died = 127; });
    child.on('close', (code) => { died = died ?? code ?? 1; });
    return child;
  };
  try {
    launch();
  } catch (e) {
    died = 127;
    tail = e.message;
  }

  const deadline = Date.now() + timeoutMs;
  let up = null;
  while (Date.now() < deadline && up === null) {
    if (died !== null) {
      // Retry único: uvicorn instalado por pip --user queda fuera del
      // PATH del spawn en algunas máquinas — `python3 -m uvicorn` no.
      if (bin === 'uvicorn' && died === 127) {
        bin = 'python3';
        args = ['-m', 'uvicorn', ...args];
        died = null;
        tail = '';
        try {
          launch();
        } catch {
          died = 127;
        }
        continue;
      }
      break;
    }
    const r = await get(kind === 'api' ? '/api/health' : '/');
    if (r.status !== null) up = r;
    else await sleepFn(300);
  }

  try {
    if (up === null) {
      const last = tail.trim().split('\n').pop() ?? '';
      if (strict) {
        add('boot', 'fail', `devCmd no levantó en ${timeoutMs / 1000}s${died !== null ? ` (exit ${died})` : ''} — ${last}`.trim());
      } else {
        add('boot', 'warn', `sin levantar (DB externa sin credenciales → skip seguro) — ${last}`.trim());
      }
      return { ok: checks.every((c) => c.status !== 'fail'), strict, checks };
    }

    if (kind === 'dev') {
      // Frontend-only: el dev server sirve el index — un 200 alcanza.
      mark('GET /', up.status === 200, `status ${up.status}`);
    } else {
      mark('GET /api/health', up.status === 200, `status ${up.status}`);

      // Contrato /api/*: rutas GET del api-surface responden (200 con
      // DB embebida; 5xx = warn con externa, 404 = wiring roto siempre).
      const endpoints = apiSurfaceFor(dir, { kind: apiSurfaceKindOf(stack?.id) })
        .filter((e) => e.method === 'GET');
      // Rutas parametrizadas (`/:id`, `/{item_id}`) no se fetchean: el
      // 404 sería del RECURSO inexistente, no de la ruta — son
      // inverificables sin un id real (verticales orders/blog las usan).
      const isParameterized = (p) => /\/:[^/]+/.test(p) || /\/\{[^/]+\}/.test(p);
      const parameterized = endpoints.filter((e) => isParameterized(e.path)).length;
      if (parameterized) {
        add('GETs parametrizados', 'warn', `${parameterized} ruta(s) con :param/{param} no verificables por smoke (sin id existente)`);
      }
      for (const ep of endpoints.filter((e) => !isParameterized(e.path))) {
        const r = await get(ep.path);
        if (r.status === 404) mark(`GET ${ep.path}`, false, '404 — ruta no montada');
        else if (r.status === 200) mark(`GET ${ep.path}`, true, '200');
        else mark(`GET ${ep.path}`, false, `status ${r.status ?? r.error}`, { warnable: !strict });
      }

      const nope = await get('/api/__smoke_nope__');
      mark('GET /api/* → 404 JSON', nope.status === 404, `status ${nope.status ?? nope.error}`);

      if (hasSpaBuild(dir)) {
        const root = await get('/');
        mark('SPA GET /', root.status === 200, `status ${root.status ?? root.error}`);
        const deep = await get('/smoke/deep-route');
        mark('SPA fallback', deep.status === 200, `status ${deep.status ?? deep.error}`);
      } else {
        add('SPA', 'warn', 'sin dist/ ni out/ — fallback no verificable');
      }
    }
  } finally {
    // Kill del process group SIEMPRE — nunca un devCmd huérfano. Sin
    // guard de `died`: en la carrera post-retry un close tardío del
    // child viejo puede pisarlo; killGroup ya tolera ESRCH.
    try {
      if (child?.pid) killGroup(child.pid);
    } catch {
      /* ya muerto */
    }
  }
  return { ok: checks.every((c) => c.status !== 'fail'), strict, checks };
}
