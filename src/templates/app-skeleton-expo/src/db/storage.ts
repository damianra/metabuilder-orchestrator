// Implementación NATIVA (Android/iOS). Metro resuelve este archivo por
// defecto y `storage.web.ts` en web — no crear un base que re-exporte
// de `.native`, porque forzaría el import nativo en web y crashearía.
//
// Regla dura de expo-sqlite: runAsync/getAllAsync aceptan SOLO arrays
// de primitivos (string|number|boolean|null) — nunca objetos.
// Fechas → toISOString(); undefined → null.
import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('app.db');

export const runAsync = (sql: string, params: (string | number | boolean | null)[] = []) =>
  db.runAsync(sql, params);

export const getAllAsync = <T = unknown>(
  sql: string,
  params: (string | number | boolean | null)[] = [],
): Promise<T[]> => db.getAllAsync<T>(sql, params);
