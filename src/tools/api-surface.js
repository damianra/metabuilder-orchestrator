// Superficie de API de un proyecto: el api-skeleton auto-monta cada
// server/routes/<name>.js en /api/<name> — basta escanear los archivos
// y capturar router.<method>('<path>'). Compartido entre el endpoint
// del dashboard y designChat (que lo inyecta al prompt del diseñador
// cuando el workspace está attachado a un backend).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Kind de scanner según el stack backend detectado — lo declara el
// def (`apiSurface`): express*/mongo/sql → 'express-routes' (default),
// nest → 'nest-controllers', fastapi → 'fastapi-routes'.
import { getStack } from '../stacks/index.js';

export const apiSurfaceKindOf = (stackId) => getStack(stackId)?.apiSurface ?? 'express-routes';

// kind: 'express-routes' (server/routes auto-mount, default) o
// 'nest-controllers' (src/**/*.controller.ts con @Controller +
// @Get/@Post/...). El kind sale del stack backend detectado.
export function apiSurfaceFor(dir, { kind = 'express-routes' } = {}) {
  if (kind === 'nest-controllers') return nestSurface(dir);
  if (kind === 'fastapi-routes') return fastapiSurface(dir);
  const routesDir = join(dir, 'server', 'routes');
  const endpoints = [];
  if (existsSync(routesDir)) {
    for (const f of readdirSync(routesDir).sort()) {
      if (!f.endsWith('.js')) continue;
      const mount = `/api/${f.slice(0, -3)}`;
      let src;
      try {
        src = readFileSync(join(routesDir, f), 'utf8');
      } catch {
        continue;
      }
      for (const m of src.matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
        endpoints.push({ method: m[1].toUpperCase(), path: mount + m[2], file: f });
      }
    }
  }
  return endpoints;
}

// FastAPI: app/routers/<name>.py → /api/<name> + decorators
// @router.<method>('<path>') — misma convención de auto-mount que
// express, otro lenguaje.
function fastapiSurface(dir) {
  const routesDir = join(dir, 'app', 'routers');
  const endpoints = [];
  if (!existsSync(routesDir)) return endpoints;
  for (const f of readdirSync(routesDir).sort()) {
    if (!f.endsWith('.py') || f.startsWith('_')) continue;
    const mount = `/api/${f.slice(0, -3)}`;
    let src;
    try {
      src = readFileSync(join(routesDir, f), 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(
      /@router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/g,
    )) {
      endpoints.push({ method: m[1].toUpperCase(), path: mount + m[2], file: f });
    }
  }
  return endpoints;
}

// NestJS: src/**/*.controller.ts → @Controller('api/items') +
// @(Get|Post|Put|Patch|Delete)('sub') → path = /<base>/<sub>.
function nestSurface(dir) {
  const srcDir = join(dir, 'src');
  const endpoints = [];
  if (!existsSync(srcDir)) return endpoints;
  let files = [];
  try {
    files = readdirSync(srcDir, { recursive: true }).sort();
  } catch {
    return endpoints;
  }
  for (const f of files) {
    const rel = String(f);
    if (!rel.endsWith('.controller.ts')) continue;
    let src;
    try {
      src = readFileSync(join(srcDir, rel), 'utf8');
    } catch {
      continue;
    }
    const base = src.match(/@Controller\(\s*['"`]([^'"`]*)['"`]\s*\)/)?.[1] ?? '';
    for (const m of src.matchAll(
      /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`]\s*)?\)/g,
    )) {
      const sub = (m[2] ?? '').replace(/^\/+/, '');
      const path = `/${base}/${sub}`.replace(/\/+/g, '/');
      endpoints.push({ method: m[1].toUpperCase(), path, file: rel.split('/').pop() });
    }
  }
  return endpoints;
}
