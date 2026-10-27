import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { config } from '../config.js';

// settings.json en la raíz del repo (gitignored) — configuración
// mutable en runtime escrita por el dashboard (POST /api/settings).
// No es .env: se relee en cada resolución (el server nunca queda con
// config stale) y no se toca el archivo donde el usuario pone
// secretos. Hoy solo { engine }.
export function readSettings(path = config.settingsPath) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

// Merge + write atómico (tmp + rename): un dashboard caído a mitad de
// escritura no debe dejar un JSON truncado que rompa cada resolución.
export function writeSettings(patch, path = config.settingsPath) {
  const next = { ...readSettings(path), ...patch };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  renameSync(tmp, path);
  return next;
}
