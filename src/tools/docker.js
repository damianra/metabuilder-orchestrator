import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

/**
 * Dockerfile + .dockerignore determinísticos en la app generada —
 * se escriben en preflight, sin consumir Devin. La variante sale de
 * la composición del scope (frontend+backend → fullstack). Con
 * frontend-only también copia nginx.conf (SPA fallback).
 */
export function writeDockerFiles(dir, { frontend, backend }) {
  const tdir = join(config.templatesDir, 'docker');
  const variant = frontend && backend ? 'fullstack' : backend ? 'backend' : 'frontend';
  copyFileSync(join(tdir, `Dockerfile.${variant}`), join(dir, 'Dockerfile'));
  copyFileSync(join(tdir, '.dockerignore'), join(dir, '.dockerignore'));
  if (variant === 'frontend') {
    copyFileSync(join(tdir, 'nginx.conf'), join(dir, 'nginx.conf'));
  }
  return variant;
}
