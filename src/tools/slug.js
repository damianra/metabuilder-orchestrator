import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'app';
}

/**
 * Devuelve un slug único dentro de baseDir y crea el directorio.
 */
export function ensureProjectDir(baseDir, name) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; existsSync(join(baseDir, slug)); i++) slug = `${base}-${i}`;
  const dir = join(baseDir, slug);
  mkdirSync(dir, { recursive: true });
  return { slug, dir };
}
