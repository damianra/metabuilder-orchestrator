import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

/**
 * Resuelve el argumento de --resume a un directorio de proyecto con
 * plan.json: acepta una ruta (absoluta o relativa al cwd) o un slug
 * dentro de generatedAppsDir. Devuelve null si no existe o no tiene
 * plan.json.
 */
export function resolveResumeDir(arg, generatedAppsDir) {
  for (const candidate of [resolve(arg), join(generatedAppsDir, arg)]) {
    if (existsSync(join(candidate, 'plan.json'))) return candidate;
  }
  return null;
}
