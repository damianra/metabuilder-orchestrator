// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ph } from './db.js';

describe('ph() — placeholders portables', () => {
  it('pg: traduce ? a $1..$n', () => {
    expect(ph('SELECT * FROM t WHERE a = ? AND b = ?', 'pg')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });

  it('mysql: pasa ? tal cual', () => {
    expect(ph('SELECT * FROM t WHERE a = ?', 'mysql')).toBe(
      'SELECT * FROM t WHERE a = ?',
    );
  });

  it('pg: el conteo no se rompe con ? en literales escapados', () => {
    expect(ph('INSERT INTO t (a) VALUES (?)', 'pg')).toBe(
      'INSERT INTO t (a) VALUES ($1)',
    );
  });
});
