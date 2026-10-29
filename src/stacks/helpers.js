// Helpers compartidos por los `detect(dir)` de los stack defs —
// módulo hoja (solo node:*) para que tools/docker.js pueda importar
// los defs sin ciclo. `marker` acepta path exacto o RegExp sobre el
// readdir del dir (next.config.* no tiene nombre fijo).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const hasMarker = (dir, marker) =>
  marker instanceof RegExp
    ? existsSync(dir) && readdirSync(dir).some((f) => marker.test(f))
    : existsSync(join(dir, marker));

// deps + devDeps del package.json del dir ({} si no existe/es ilegible).
export const pkgDeps = (dir) => {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
};

// Valor de KEY=... en el .env del dir (null si falta).
export const envValue = (dir, key) => {
  try {
    return readFileSync(join(dir, '.env'), 'utf8').match(new RegExp(`^${key}=(\\w+)`, 'm'))?.[1] ?? null;
  } catch {
    return null;
  }
};
