import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeContractTest } from '../src/tools/contract-test.js';

const ROUTE = `import { Router } from 'express';
const router = Router();
router.get('/', (req, res) => res.json({}));
export default router;
`;

const fastapiDir = (d) => {
  mkdirSync(join(d, 'app', 'routers'), { recursive: true });
  writeFileSync(
    join(d, 'app', 'routers', 'items.py'),
    "@router.get('/')\n@router.post('/')\n",
  );
};

describe('writeContractTest', () => {
  it('express: emite vitest con los endpoints embebidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-ct-'));
    mkdirSync(join(dir, 'server', 'routes'), { recursive: true });
    writeFileSync(join(dir, 'server', 'routes', 'items.js'), ROUTE);
    const out = writeContractTest(dir, { kind: 'express-routes' });
    expect(out).toBe('test/api-contract.test.js');
    const src = readFileSync(join(dir, out), 'utf8');
    expect(src).toContain('"path": "/api/items/"');
    expect(src).toContain('"method": "get"');
    expect(src).toContain('router');
  });

  it('fastapi: emite pytest test_api_contract.py', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-ct-'));
    fastapiDir(dir);
    const out = writeContractTest(dir, { kind: 'fastapi-routes' });
    expect(out).toBe('test_api_contract.py');
    const src = readFileSync(join(dir, out), 'utf8');
    expect(src).toContain('@router\\.');
  });

  it('sin endpoints → null (no emite archivo)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-ct-'));
    expect(writeContractTest(dir, { kind: 'express-routes' })).toBeNull();
    expect(existsSync(join(dir, 'test'))).toBe(false);
  });
});
