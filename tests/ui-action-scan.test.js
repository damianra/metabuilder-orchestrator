import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actionScanBlock, uiActionScan } from '../src/tools/ui-action-scan.js';

let dir;
const mk = (f, content) => {
  const p = join(dir, 'src', f);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
};
afterEach(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'uiact-')); });

describe('uiActionScan', () => {
  it('botón sin handler → dead-button; submit se salta', () => {
    mk('a.jsx', `export default () => (<div>
      <button className="x">Guardar</button>
      <button type="submit">Ok</button>
      <button onClick={save}>Bien</button>
    </div>);`);
    const f = uiActionScan(dir);
    expect(f.filter((x) => x.kind === 'dead-button')).toHaveLength(1);
    expect(f[0].line).toBe(2);
  });

  it('handler vacío/mock → empty-handler + mock-data', () => {
    mk('b.jsx', `const mockData = [{x:1}];
      <button onClick={() => {}}>nada</button>
      <button onClick={() => console.log('x')}>mock</button>
      <Chart data={[1,2,3]} />`);
    const kinds = uiActionScan(dir).map((x) => x.kind);
    expect(kinds.filter((k) => k === 'empty-handler')).toHaveLength(2);
    expect(kinds).toContain('mock-data');
  });

  it('sin falsos positivos: handler real, fetch con ${id}, prefetch, ruta versionada', () => {
    mk('ok.jsx', `export default () => (<div>
      <button onClick={() => { navigate('/x') }}>real</button>
      <button onClick={() => { console.log('x'); doThing() }}>real2</button>
    </div>);
    fetch(\`/api/items/\${id}\`); prefetch('/api/items'); fetch('/api/v1/users');`);
    const f = uiActionScan(dir, { apiSurface: ['/api/items/:id', '/api/v1/users'] });
    expect(f.filter((x) => x.kind === 'empty-handler')).toHaveLength(0);
    expect(f.filter((x) => x.kind === 'missing-endpoint')).toHaveLength(0);
  });

  it('fetch a endpoint inexistente → missing-endpoint', () => {
    mk('c.js', `fetch('/api/pedidos').then(r=>r.json()); api.get('/api/items');`);
    const f = uiActionScan(dir, { apiSurface: [{ method: 'GET', path: '/api/items' }] });
    expect(f).toHaveLength(1);
    expect(f[0].detail).toBe('/api/pedidos');
  });

  it('endpoint con param matchea ruta parametrizada', () => {
    mk('d.js', `fetch('/api/items/42'); fetch('/api/items/abc-1234');`);
    const f = uiActionScan(dir, { apiSurface: ['/api/items/{id}'] });
    expect(f).toHaveLength(0);
  });

  it('dir inexistente → [] sin throw', () => {
    expect(uiActionScan('/no/existe')).toEqual([]);
  });

  it('actionScanBlock renderiza findings o mensaje limpio', () => {
    expect(actionScanBlock([])).toContain('sin accionables');
    mk('e.jsx', '<button>x</button>');
    expect(actionScanBlock(uiActionScan(dir))).toContain('dead-button');
  });
});
