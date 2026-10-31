import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Scanner del contrato front→API (extend): el frontend ya declara qué
// backend espera — sus llamadas fetch/api son la spec exacta. En vez
// de que el agente infiera la API de la idea, extraemos los endpoints
// que el front realmente llama y se los pasamos al planner.
const SKIP = new Set(['node_modules', 'dist', 'out', 'build', '.next']);
const EXT = /\.(jsx?|tsx?)$/;

const walk = (dir, base, out = []) => {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // symlink roto o permiso — no tumbar el planner por eso
    }
    if (st.isDirectory()) {
      if (!SKIP.has(f) && !f.startsWith('.')) walk(p, base, out);
    } else if (EXT.test(f)) {
      out.push(relative(base, p));
    }
  }
  return out;
};

/**
 * Extrae `METHOD /api/...` de las llamadas fetch/api del front.
 * Cubre: fetch('/api/x'[, {method}]), fetch(`/api/x`), api.get/post/...
 * ('/api/x'), axios-style .get('/api/x'). Parametrizados quedan como
 * `/api/x/:param` colapsando ${vars}.
 * @returns [{method, path, file}]
 */
export function frontApiScan(dir) {
  const srcRoot = join(dir, 'src');
  if (!existsSync(srcRoot)) return [];
  const out = [];
  const seen = new Set();
  for (const rel of walk(srcRoot, dir)) {
    let src;
    try {
      src = readFileSync(join(dir, rel), 'utf8');
    } catch {
      continue;
    }
    // fetch('/api/...'[, {method:'X'}]) — el method se busca en los
    // 200 chars posteriores a la URL (segundo arg, mismo call).
    for (const m of src.matchAll(/fetch\(\s*['"`](\/api\/[^'"`]*)['"`]/g)) {
      // solo dentro del propio call: hasta el primer `)` tras la URL
      const close = src.indexOf(')', m.index + m[0].length);
      const tail = src.slice(m.index, close > 0 ? close : m.index + m[0].length + 200);
      const method = tail.match(/method:\s*['"`](\w+)['"`]/)?.[1]?.toUpperCase() ?? 'GET';
      push(out, seen, method, normalizePath(m[1]), rel, fieldsAfter(src, m.index));
    }
    // api.<method>('/api/...') — cliente lib/api.js
    for (const m of src.matchAll(
      /\b(?:api|client|http)\.(get|post|put|patch|delete)\s*\(\s*['"`](\/api\/[^'"`]*)['"`]/g,
    )) {
      push(out, seen, m[1].toUpperCase(), normalizePath(m[2]), rel, fieldsAfter(src, m.index));
    }
  }
  return out;
}

const normalizePath = (p) => p.split('?')[0].replace(/\$\{[^}]+\}/g, ':param');

function push(out, seen, method, path, file, fields = []) {
  const key = `${method} ${path}`;
  if (seen.has(key)) {
    const entry = out.find((e) => e.method === method && e.path === path);
    if (entry && fields.length) entry.fields = [...new Set([...entry.fields, ...fields])];
    return;
  }
  seen.add(key);
  out.push({ method, path, file, fields });
}

// Campos que el front consume de la respuesta: tras el call, un acceso
// `x.campo` / `x?.campo` sobre la variable/respuesta indica la shape
// esperada. Heurística con ruido filtrado — no es AST, es suficiente
// para que el backend extienda el DTO correcto.
const FIELD_NOISE = new Set([
  'data', 'json', 'then', 'map', 'filter', 'forEach', 'length', 'ok',
  'status', 'statusText', 'message', 'error', 'push', 'slice', 'find',
  'findIndex', 'includes', 'indexOf', 'toUpperCase', 'toLowerCase',
  'toFixed', 'toString', 'join', 'split', 'trim', 'reduce', 'some',
  'every', 'keys', 'values', 'entries', 'has', 'get', 'set', 'catch',
  'finally', 'sort', 'reverse', 'concat', 'flatMap', 'flat', 'fill',
  'preventDefault', 'stopPropagation', 'target', 'value', 'checked',
  'name', 'id', 'key', 'type', 'href', 'src', 'alt', 'className',
  'style', 'children', 'props', 'state', 'setState', 'current',
]);
function fieldsAfter(src, index) {
  const window = src.slice(index, index + 700);
  const fields = new Set();
  for (const m of window.matchAll(/\b\w+[?]?\.(\w+)/g)) {
    if (!FIELD_NOISE.has(m[1]) && m[1].length > 2) fields.add(m[1]);
  }
  return [...fields].slice(0, 12);
}
