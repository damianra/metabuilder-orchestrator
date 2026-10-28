import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

/**
 * Dockerfile + .dockerignore determinísticos en la app generada —
 * se escriben en preflight, sin consumir Devin. La variante sale de
 * la composición del scope (frontend+backend → fullstack). Con
 * frontend-only también copia nginx.conf (SPA fallback).
 *
 * `outDir` = directorio de build del stack frontend ('dist' en Vite,
 * 'out' en Next export) — los templates llevan @OUT_DIR@.
 */
export function writeDockerFiles(dir, { frontend, backend, outDir }) {
  const tdir = join(config.templatesDir, 'docker');
  const variant = frontend && backend ? 'fullstack' : backend ? 'backend' : 'frontend';
  const tpl = readFileSync(join(tdir, `Dockerfile.${variant}`), 'utf8');
  writeFileSync(join(dir, 'Dockerfile'), tpl.replaceAll('@OUT_DIR@', outDir ?? 'dist'));
  copyFileSync(join(tdir, '.dockerignore'), join(dir, '.dockerignore'));
  if (variant === 'frontend') {
    copyFileSync(join(tdir, 'nginx.conf'), join(dir, 'nginx.conf'));
  }
  return variant;
}

const hasFile = (dir, re) => readdirSync(dir).some((f) => re.test(f));

// ¿El proyecto tiene frontend? Vite o Next config en la raíz.
export const detectFrontend = (dir) =>
  existsSync(join(dir, 'vite.config.js')) ||
  existsSync(join(dir, 'vite.config.mjs')) ||
  hasFile(dir, /^next\.config\.(m?js|ts)$/);

// Directorio de build del frontend: Next exporta a out/, Vite a dist/.
// null si el proyecto no tiene frontend detectable.
export const detectOutDir = (dir) =>
  !detectFrontend(dir) ? null : hasFile(dir, /^next\.config\.(m?js|ts)$/) ? 'out' : 'dist';

// Id del stack frontend según los archivos (para resume de apps sin
// plan.stacks): next.config.* → 'nextjs', vite.config.* → 'vite-react',
// sin frontend → null.
export const detectStackId = (dir) => {
  const outDir = detectOutDir(dir);
  return outDir === 'out' ? 'nextjs' : outDir === 'dist' ? 'vite-react' : null;
};

// Id del stack backend por las deps del package.json (para apps sin
// plan.stacks y workspaces): better-sqlite3 → express-sqlite,
// mongodb → express-mongo, nest → nest-typeorm, pg/mysql2 → sql
// (el skeleton-sql instala ambos drivers — .env DB_DRIVER desempata,
// default pg como en server/db.js).
export const detectBackendStackId = (dir) => {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['better-sqlite3']) return 'express-sqlite';
  if (deps.mongodb) return 'express-mongo';
  if (deps['@nestjs/core'] || existsSync(join(dir, 'nest-cli.json'))) return 'nest-typeorm';
  if (deps.pg || deps.mysql2) {
    try {
      const d = readFileSync(join(dir, '.env'), 'utf8').match(/^DB_DRIVER=(\w+)/m)?.[1];
      if (d === 'mysql') return 'express-mysql';
      if (d === 'pg') return 'express-postgres';
    } catch {
      /* sin .env → default del skeleton */
    }
    return 'express-postgres';
  }
  return null;
};
