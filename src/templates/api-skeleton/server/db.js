import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedData } from './seed-data.js';

const here = dirname(fileURLToPath(import.meta.url));
let db;

/**
 * Singleton SQLite: abre la base, aplica schema.sql (idempotente —
 * usar CREATE TABLE IF NOT EXISTS) y corre el seed de las tablas
 * vacías.
 *
 * Fallback documentado: si la compilación nativa de better-sqlite3
 * falla en el entorno, cambiar por `new DatabaseSync(path)` de
 * node:sqlite — la API es casi idéntica (prepare/run/get/all).
 */
export function openDb(path = join(here, 'app.sqlite')) {
  if (db) return db;
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schemaPath = join(here, 'schema.sql');
  if (existsSync(schemaPath)) db.exec(readFileSync(schemaPath, 'utf8'));
  for (const [table, rows] of Object.entries(seedData)) seedIfEmpty(table, rows);
  return db;
}

export function seedIfEmpty(table, rows) {
  if (!rows?.length) return;
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  if (c > 0) return;
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  );
  db.transaction((list) => {
    for (const row of list) stmt.run(...cols.map((col) => row[col]));
  })(rows);
}
