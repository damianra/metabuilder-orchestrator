import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiSurfaceFor } from './api-surface.js';

// Contract test estático por endpoint (v13 #13): en vez de que el
// agente escriba un test por ruta (tokens + variabilidad), se emite UN
// archivo que verifica cada endpoint del api-surface — el archivo de
// rutas existe y registra el método. Zero-dep: corre dentro del
// `npm test`/`pytest` propio de la app. El montaje en vivo (boot +
// HTTP real) lo cubre el nodo smoke — este chequeo viaja con la app.
const JS_CHECK = { 'express-routes': 'router', 'nest-controllers': '@' };

function jsContractTest(endpoints, kind) {
  const rows = endpoints.map((e) => ({
    method: e.method.toLowerCase(),
    path: e.path,
    file: e.file,
  }));
  return `// Generado por MetaBuilder — contrato estático del api-surface.
// Cada endpoint del backend debe seguir registrado en su archivo de
// rutas. Si el dominio elimina/reubica un endpoint, actualizar este
// archivo es honesto — pero que falle = wiring roto.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINTS = ${JSON.stringify(rows, null, 2)};

const find = (dir, name) => {
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    } else if (f === name) return p;
  }
  return null;
};

describe('api contract (endpoints del dominio registrados)', () => {
  for (const e of ENDPOINTS) {
    it(\`\${e.method.toUpperCase()} \${e.path} (\${e.file})\`, () => {
      const file = find('server', e.file);
      expect(file, \`\${e.file} debe existir bajo server/\`).toBeTruthy();
      const src = readFileSync(file, 'utf8');
      ${kind === 'nest-controllers'
        ? "const re = new RegExp(`@` + e.method[0].toUpperCase() + e.method.slice(1) + `\\\\(`);"
        : "const re = new RegExp(`router\\\\.` + e.method + `\\\\(`);"}
      expect(src, \`\${e.file} debe registrar \${e.method.toUpperCase()}\`).toMatch(re);
    });
  }
});
`;
}

function pyContractTest(endpoints) {
  const rows = endpoints.map((e) => ({
    method: e.method.toLowerCase(),
    path: e.path,
    file: e.file,
  }));
  return `"""Generado por MetaBuilder — contrato estático del api-surface.

Cada endpoint del backend debe seguir registrado en su archivo de
routers. Si el dominio elimina/reubica un endpoint, actualizar este
archivo es honesto — pero que falle = wiring roto.
"""
from pathlib import Path
import re
import pytest

ENDPOINTS = ${JSON.stringify(rows, null, 2)}
ROUTERS = Path(__file__).resolve().parent / "app" / "routers"


@pytest.mark.parametrize("e", ENDPOINTS, ids=lambda e: f"{e['method'].upper()} {e['path']}")
def test_endpoint_registered(e):
    file = ROUTERS / e["file"]
    assert file.exists(), f"{e['file']} debe existir en app/routers"
    src = file.read_text()
    assert re.search(rf"@router\\.{e['method']}\\(", src), (
        f"{e['file']} debe registrar {e['method'].upper()}"
    )
`;
}

/** Emite el contract test del stack; devuelve el path relativo o null. */
export function writeContractTest(dir, { kind = 'express-routes' } = {}) {
  const endpoints = apiSurfaceFor(dir, { kind });
  if (!endpoints.length) return null;
  if (kind === 'fastapi-routes') {
    const path = join(dir, 'test_api_contract.py');
    writeFileSync(path, pyContractTest(endpoints));
    return 'test_api_contract.py';
  }
  if (!(kind in JS_CHECK)) return null;
  const testDir = join(dir, 'test');
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, 'api-contract.test.js'), jsContractTest(endpoints, kind));
  return 'test/api-contract.test.js';
}
