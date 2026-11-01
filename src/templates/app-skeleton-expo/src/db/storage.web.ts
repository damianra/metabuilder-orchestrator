// Implementación WEB (preview): expo-sqlite no corre en web sin
// config WASM — este mock en memoria mantiene la misma firma para que
// el preview no crashee. NO es persistente (vive en la sesión).
// Metro resuelve este archivo automáticamente en plataforma web.
const store: Record<string, unknown[]> = {};

export const db = null;

export const runAsync = async (
  _sql: string,
  _params: (string | number | boolean | null)[] = [],
): Promise<void> => {
  /* no-op: persistencia real solo en nativo */
};

export const getAllAsync = async <T = unknown>(
  sql: string,
  _params: (string | number | boolean | null)[] = [],
): Promise<T[]> => (store[sql] as T[]) ?? [];
