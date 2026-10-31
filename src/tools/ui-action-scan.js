import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Scanner de accionabilidad del front: detecta componentes interactivos
// que NO están cableados — botones sin handler (o handler vacío/mock),
// datos literales renderizados donde debería haber fetch, y llamadas a
// /api/* que el api-surface del backend no tiene (acción rota segura).
// Regex-based como front-api-scan — puro y testeable en tmpdir.
const SKIP = new Set(['node_modules', 'dist', 'out', 'build', '.next', '.venv', 'coverage']);
const EXT = /\.(jsx?|tsx?)$/;

const walk = (dir, base, out = []) => {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP.has(f) && !f.startsWith('.')) walk(p, base, out);
    } else if (EXT.test(f)) {
      out.push(relative(base, p));
    }
  }
  return out;
};

// Rutas llamadas por el front: fetch('/api/x'), api.get|post|put|delete('/api/x')
// (\b antes de fetch — `prefetch`/`apiFetch` propios no son la api).
const CALL_RE = /\b(?:fetch|api\.(?:get|post|put|delete|patch))\s*\(\s*['"`]([^'"`]+)['"`]/g;
const BUTTON_RE = /<button\b[^>]*>/g;
// Handler REALMENTE vacío: `() => {}` / `() => ()` — no cualquier cuerpo.
const EMPTY_HANDLER_RE = /onClick=\{[^{}]*=>\s*(\{\s*\}|\(\s*\))\s*\}/;
// Handler cuyo ÚNICO statement es ruido (console.log/alert/TODO) — uno
// con console.log + lógica real no es mock.
const MOCK_HANDLER_RE =
  /onClick=\{[^{}]*=>\s*\{?\s*(?:console\.log\s*\([^)]*\)|alert\s*\([^)]*\)|TODO\b)[^{};]*;?\s*\}?\s*\}/;
const MOCK_IDENT_RE = /\b(mock|dummy|sample|demo)\w*\s*=\s*(\[|\{)/i;
const LITERAL_DATA_RE = /\b(?:data|items|rows|options|series)=\{\s*\[\s*[{0-9'"]/;

/**
 * Escanea el front de `dir` buscando accionables no cableados.
 * `apiSurface`: array de paths ('/api/x') o {method,path} — si se pasa,
 * las llamadas del front a rutas inexistentes se reportan como
 * 'missing-endpoint' (acción rota segura).
 * Devuelve [{ kind, file, line, detail }] — sin throws.
 */
export function uiActionScan(dir, { apiSurface = null } = {}) {
  const findings = [];
  if (!existsSync(dir)) return findings;
  const srcDir = existsSync(join(dir, 'src')) ? join(dir, 'src') : dir;
  const knownPaths = apiSurface
    ? new Set(
        apiSurface.map((e) => (typeof e === 'string' ? e : e.path)).map((p) => p.replace(/<[^>]+>|\{[^}]+\}|:\w+/g, '{param}')),
      )
    : null;
  // Normaliza params dinámicos por SEGMENTO completo (`/api/items/42`,
  // `/api/items/${id}`, uuid) — `/api/v1/users` no se toca.
  const norm = (p) =>
    p
      .replace(/\$\{[^}]+\}/g, '{param}')
      .replace(/\/\d+(?=\/|$)/g, '/{param}')
      .replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, '/{param}')
      .replace(/\/$/, '');

  for (const file of walk(srcDir, srcDir)) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    const lines = text.split('\n');

    // 1) <button> sin handler — tag completo en una línea; se salta
    //    type="submit" (el form padre tiene onSubmit).
    for (const m of text.matchAll(BUTTON_RE)) {
      const tag = m[0];
      if (/onClick\s*=/.test(tag) || /type\s*=\s*['"]submit['"]/.test(tag)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ kind: 'dead-button', file, line, detail: tag.slice(0, 80) });
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // 2) Handler vacío o de mock
      if (EMPTY_HANDLER_RE.test(l) || MOCK_HANDLER_RE.test(l)) {
        findings.push({ kind: 'empty-handler', file, line: i + 1, detail: l.trim().slice(0, 80) });
      }
      // 3) Datos literales donde debería haber fetch
      if (MOCK_IDENT_RE.test(l) || LITERAL_DATA_RE.test(l)) {
        findings.push({ kind: 'mock-data', file, line: i + 1, detail: l.trim().slice(0, 80) });
      }
    }

    // 4) Llamadas a rutas que el backend no tiene
    if (knownPaths) {
      for (const m of text.matchAll(CALL_RE)) {
        const p = m[1];
        if (!p.startsWith('/api')) continue;
        if (!knownPaths.has(norm(p))) {
          const line = text.slice(0, m.index).split('\n').length;
          findings.push({ kind: 'missing-endpoint', file, line, detail: p });
        }
      }
    }
  }
  return findings;
}

// Render compacto para prompts de agente (review/fixer).
export const actionScanBlock = (findings, { max = 30 } = {}) =>
  findings.length
    ? findings
        .slice(0, max)
        .map((f) => `- [${f.kind}] ${f.file}:${f.line} — ${f.detail}`)
        .join('\n')
    : '(sin accionables rotos detectados)';
