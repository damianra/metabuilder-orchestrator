import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frontApiScan } from '../src/tools/front-api-scan.js';

const app = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'mb-fas-'));
  for (const [p, content] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
};

describe('frontApiScan', () => {
  it('extrae fetch GET/POST y api.* de src/', () => {
    const dir = app({
      'src/App.jsx': `fetch('/api/gastos');
fetch('/api/gastos', { method: 'POST' });
api.delete('/api/gastos/' + id);`,
      'src/lib/api.js': `const api = { get: (p) => fetch(p) }; api.get('/api/health');`,
    });
    const eps = frontApiScan(dir);
    const paths = eps.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain('GET /api/gastos');
    expect(paths).toContain('GET /api/health');
  });

  it('colapsa template params y dedupes', () => {
    const dir = app({
      'src/x.jsx': `fetch(\`/api/gastos/\${id}\`); fetch('/api/gastos/1');`,
    });
    expect(frontApiScan(dir).some((e) => e.path === '/api/gastos/:param')).toBe(true);
  });

  it('sin src/ o sin llamadas → []', () => {
    expect(frontApiScan(app({ 'README.md': 'x' }))).toEqual([]);
    expect(frontApiScan(app({ 'src/a.jsx': 'const x = 1;' }))).toEqual([]);
  });
});
