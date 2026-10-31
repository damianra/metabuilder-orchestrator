import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { getStack, listStacks } from '../stacks/index.js';
import { hasMarker } from '../stacks/helpers.js';

/**
 * Dockerfile + .dockerignore determinísticos en la app generada —
 * se escriben en preflight, sin consumir Devin. La variante sale de
 * la composición del scope (frontend+backend → fullstack). Con
 * frontend-only también copia nginx.conf (SPA fallback).
 *
 * `outDir` = directorio de build del stack frontend ('dist' en Vite,
 * 'out' en Next export) — los templates llevan @OUT_DIR@.
 * `@ALEMBIC@` (línea propia) → los COPY de alembic.ini + alembic/
 * cuando el proyecto tiene migraciones (alembic.ini presente); sin
 * alembic.ini el placeholder desaparece — los templates python son
 * compartidos con stacks sin migraciones (fastapi-mongo).
 */

// --- Detección por stack defs ---
// La identificación de stacks vive en cada def (`detect`, `detectPriority`,
// `toolchain.markers`) — este módulo solo orquesta: agregar un stack
// (incluido uno no-Node) nunca toca estas funciones.

const byPriority = (a, b) => (a.detectPriority ?? 100) - (b.detectPriority ?? 100);

// ¿El proyecto tiene backend? Al menos un marker declarado por los
// stacks backend (express* → server/, nest → nest-cli.json).
export const hasBackendDir = (dir) =>
  listStacks('backend').some((s) => (s.toolchain?.markers ?? []).some((m) => hasMarker(dir, m)));

// ¿El manifest de este stack está en el dir? (package.json, requirements.txt…)
export const manifestExists = (dir, stack) =>
  Boolean(stack?.toolchain?.manifest) && existsSync(join(dir, stack.toolchain.manifest));

// ¿Al menos un stack activo tiene su manifest en el dir?
export const anyManifest = (dir, stacks) =>
  [stacks.frontend, stacks.backend].some((s) => manifestExists(dir, s));

// ¿Algún manifest de stack backend? (workspace backend-work: la sesión
// existe si hay manifest, cualquiera sea el stack elegido).
export const anyBackendManifest = (dir) =>
  listStacks('backend').some((s) => manifestExists(dir, s));

// Comandos de install a lanzar: por cada stack activo cuyo manifest
// existe, su `toolchain.installCmd` — dedup por comando (front+back
// Node comparten 'npm install').
export const installCommands = (dir, stacks) => {
  const cmds = [];
  for (const s of [stacks.frontend, stacks.backend].filter(Boolean)) {
    const { manifest, installCmd } = s.toolchain ?? {};
    if (manifest && installCmd && existsSync(join(dir, manifest)) && !cmds.includes(installCmd)) {
      cmds.push(installCmd);
    }
  }
  return cmds;
};

export function writeDockerFiles(dir, { frontend, backend, outDir, backendStackId }) {
  const tdir = join(config.templatesDir, 'docker');
  // El template de la variante backend lo declara el stack
  // (`toolchain.dockerfile`): express → 'backend' (node slim, corre
  // server/index.js), nest → 'backend-ts' (stage tsc + dist-server/).
  const backStack = backend ? getStack(backendStackId ?? detectBackendStackId(dir)) : null;
  const variant = frontend && backend
    ? // fullstack comparte el template node salvo que el stack backend
      // declare uno propio (fastapi → fullstack-python: el runtime del
      // container es python, no node).
      backStack?.toolchain?.dockerfileFullstack ?? 'fullstack'
    : backend
      ? backStack?.toolchain?.dockerfile ?? 'backend'
      : 'frontend';
  const tpl = readFileSync(join(tdir, `Dockerfile.${variant}`), 'utf8');
  const alembic = existsSync(join(dir, 'alembic.ini'))
    ? 'COPY alembic.ini ./\nCOPY alembic ./alembic\n'
    : '';
  writeFileSync(
    join(dir, 'Dockerfile'),
    tpl.replaceAll('@OUT_DIR@', outDir ?? 'dist').replaceAll('@ALEMBIC@\n', alembic),
  );
  copyFileSync(join(tdir, '.dockerignore'), join(dir, '.dockerignore'));
  if (variant === 'frontend') {
    copyFileSync(join(tdir, 'nginx.conf'), join(dir, 'nginx.conf'));
  }
  return variant;
}

// Primer stack frontend cuyo `detect` matchea (por detectPriority —
// next.config.* le gana a vite.config si hay ambos).
const detectFrontendStack = (dir) =>
  [...listStacks('frontend')].sort(byPriority).find((s) => s.detect?.(dir)) ?? null;

// ¿El proyecto tiene frontend? Lo decide el `detect` de los stacks
// frontend (vite.config.* / next.config.* hoy).
export const detectFrontend = (dir) => detectFrontendStack(dir) !== null;

// Directorio de build del frontend detectado (`buildDir` del stack:
// Next exporta a out/, Vite a dist/). null si no hay frontend.
export const detectOutDir = (dir) => detectFrontendStack(dir)?.buildDir ?? null;

// Id del stack frontend según los archivos (para resume de apps sin
// plan.stacks): next.config.* → 'nextjs', vite.config.* → 'vite-react',
// sin frontend → null.
export const detectStackId = (dir) => detectFrontendStack(dir)?.id ?? null;

// Id del stack backend: primer `detect` que matchea, por
// `detectPriority` (nest primero — trae `mongodb` como dep y le
// ganaría a express-mongo; mysql/postgres se desempatan por
// DB_DRIVER en .env dentro de sus propios detect). Para apps sin
// plan.stacks y workspaces.
export const detectBackendStackId = (dir) =>
  [...listStacks('backend')].sort(byPriority).find((s) => s.detect?.(dir))?.id ?? null;
