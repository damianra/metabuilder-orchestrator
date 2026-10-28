import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedData } from './seed-data.js';

const here = dirname(fileURLToPath(import.meta.url));
const DRIVER = process.env.DB_DRIVER || 'pg';
let pool;

/**
 * Singleton multi-driver (pg | mysql) sobre `DB_DRIVER` en .env.
 *
 * `q(text, params)` — prepared statements con placeholders `?`:
 * los traduce a `$1..$n` cuando el driver es pg (mysql los usa
 * nativo). Devuelve siempre un array de filas (pg `res.rows`,
 * mysql `res[0]`). Para INSERT/UPDATE devuelve las filas afectadas
 * — el id nuevo en pg con `RETURNING id`, en mysql con
 * `result.insertId` (vía `insert()`).
 *
 * Schema: DDL por driver en SCHEMAS — idempotente
 * (CREATE TABLE IF NOT EXISTS), corre al primer uso. El agente
 * agrega tablas extendiendo SCHEMAS, no con migraciones.
 */
const SCHEMAS = {
  pg: `CREATE TABLE IF NOT EXISTS items (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
  mysql: `CREATE TABLE IF NOT EXISTS items (
    id INTEGER AUTO_INCREMENT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
};

// Traduce `?` a `$1..$n` para pg — mysql pasa tal cual.
export function ph(text, driver = DRIVER) {
  if (driver !== 'pg') return text;
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

export async function openDb() {
  if (pool) return pool;
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || (DRIVER === 'mysql' ? 3306 : 5432)),
    database: process.env.DB_NAME || 'app',
    user: process.env.DB_USER || (DRIVER === 'mysql' ? 'root' : 'postgres'),
    password: process.env.DB_PASSWORD || '',
  };
  if (DRIVER === 'mysql') {
    const { createPool } = await import('mysql2/promise');
    pool = createPool({ ...cfg, waitForConnections: true, connectionLimit: 5 });
  } else {
    const { Pool } = await import('pg');
    pool = new Pool({ ...cfg, max: 5 });
  }
  await pool.query(SCHEMAS[DRIVER] ?? SCHEMAS.pg);
  for (const [table, rows] of Object.entries(seedData)) await seedIfEmpty(table, rows);
  return pool;
}

// Inserta las filas solo si la tabla está vacía (idempotente).
export async function seedIfEmpty(table, rows = []) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const [{ n }] = await q(`SELECT COUNT(*) AS n FROM ${table}`);
  if (Number(n) > 0) return;
  const marks = `(${cols.map(() => '?').join(',')})`;
  for (const row of rows) {
    await q(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${marks}`,
      cols.map((c) => row[c]),
    );
  }
}

// Prepared statement → array de filas normalizado.
export async function q(text, params = []) {
  const p = await openDb();
  const res = await p.query(ph(text), params);
  return DRIVER === 'mysql' ? res[0] : res.rows;
}

// Insert helper: devuelve el id nuevo — mysql usa result.insertId;
// en pg se appendea `RETURNING id` si el statement no lo trae.
export async function insert(text, params = []) {
  const p = await openDb();
  const sql =
    DRIVER === 'pg' && !/returning\s/i.test(text)
      ? `${text.replace(/;\s*$/, '')} RETURNING id`
      : text;
  const res = await p.query(ph(sql), params);
  if (DRIVER === 'mysql') return res[0].insertId;
  return res.rows?.[0]?.id ?? null;
}

export function closeDb() {
  const p = pool;
  pool = null;
  return p?.end();
}
