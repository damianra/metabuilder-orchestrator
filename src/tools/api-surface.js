// Superficie de API de un proyecto: el api-skeleton auto-monta cada
// server/routes/<name>.js en /api/<name> — basta escanear los archivos
// y capturar router.<method>('<path>'). Compartido entre el endpoint
// del dashboard y designChat (que lo inyecta al prompt del diseñador
// cuando el workspace está attachado a un backend).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function apiSurfaceFor(dir) {
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
