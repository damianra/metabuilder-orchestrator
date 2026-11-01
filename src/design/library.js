// Biblioteca de diseños archivados (v15) — design-library/<slug>/.
// Antes "descartar" borraba todo; ahora "archivar" mueve el workspace
// de diseño (web o mobile) a la biblioteca con su state (el historial
// de chat = prompt de reconstrucción), un spec.md de estilos y, si hay
// preview corriendo + Playwright instalado, un screenshot de referencia.
//
// Estructura por entrada:
//   meta.json      {slug, kind:'web'|'mobile', name, description, created}
//   state.json     snapshot del design-state/mobile-state.json
//   workspace/     código (mismo exclude que save + .reference/dist/.expo)
//   spec.md        resumen heurístico de estilos/animaciones/archivos
//   screenshot.png captura del preview (opcional — Playwright)
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import { config } from '../config.js';

export const LIBRARY_DIR = join(config.rootDir, 'design-library');
export const LIB_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

const ARCHIVE_EXCLUDE = new Set([
  'node_modules',
  'design-state.json',
  'mobile-state.json',
  'dev-run.json',
  'dev-run.log',
  '.env',
  '.reference', // referencias copiadas dentro del workspace — no anidar
  'dist',
  '.expo',
  '.next',
  '.git',
]);

// "Mi Diseño de Hábitos!" → "mi-diseno-de-habitos" (sin acentos,
// colapsando separadores) — base para slugs automáticos.
export const slugify = (text = '') =>
  String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'diseno';

const entryDir = (slug, libDir = LIBRARY_DIR) => join(libDir, slug);

export function getEntry(slug, libDir = LIBRARY_DIR) {
  if (!LIB_SLUG_RE.test(slug ?? '')) return null;
  const metaPath = join(entryDir(slug, libDir), 'meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    return { ...JSON.parse(readFileSync(metaPath, 'utf8')), slug };
  } catch {
    return null;
  }
}

// Lista de entradas (más recientes primero) + flags para la UI.
export function listLibrary(libDir = LIBRARY_DIR) {
  if (!existsSync(libDir)) return [];
  return readdirSync(libDir)
    .filter((d) => {
      try {
        return statSync(join(libDir, d)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((slug) => getEntry(slug, libDir))
    .filter(Boolean)
    .map((m) => ({
      ...m,
      hasSpec: existsSync(join(entryDir(m.slug, libDir), 'spec.md')),
      hasShot: existsSync(join(entryDir(m.slug, libDir), 'screenshot.png')),
    }))
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
}

const uniqueSlug = (base, libDir = LIBRARY_DIR) => {
  let slug = base;
  for (let i = 2; existsSync(entryDir(slug, libDir)); i++) slug = `${base}-${i}`;
  return slug;
};

// --- Spec heurístico: escanea el código y resume lo reutilizable ---
const SRC_EXT = new Set(['.jsx', '.tsx', '.js', '.ts', '.css', '.html']);
const SRC_DIRS = ['src', 'app', 'components', 'index.html', 'global.css', 'tailwind.config.js', 'app.json'];
const MAX_SCAN_FILES = 40;

function sourceFiles(workDir) {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 4 || out.length >= MAX_SCAN_FILES) return;
    for (const name of readdirSync(dir)) {
      if (ARCHIVE_EXCLUDE.has(name) || name.startsWith('.git')) continue;
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else if (SRC_EXT.has(extname(name)) && st.size < 200_000) out.push(p);
      } catch { /* permisos/symlinks rotos — ignorar */ }
    }
  };
  for (const top of SRC_DIRS) {
    const p = join(workDir, top);
    if (!existsSync(p)) continue;
    try {
      statSync(p).isDirectory() ? walk(p) : out.push(p);
    } catch { /* ignorar */ }
  }
  return out;
}

const topCounts = (map, n = 12) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

// Extrae colores, animaciones, tipografías, iconos y estructura — lo
// suficiente para que el agente "use los estilos de esta app" sin
// adivinar, y para que el humano recuerde qué era el diseño.
export function makeSpec({ workDir, kind, state = {}, name = '', description = '' }) {
  const colors = new Map();
  const anims = new Map();
  const fonts = new Map();
  const icons = new Map();
  const files = [];
  for (const file of sourceFiles(workDir)) {
    files.push(file.slice(workDir.length + 1));
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) colors.set(m[0].toLowerCase(), (colors.get(m[0].toLowerCase()) ?? 0) + 1);
    for (const m of text.matchAll(/\b(?:animate|transition|duration|ease|delay)-[a-z0-9[\]-]+/g)) anims.set(m[0], (anims.get(m[0]) ?? 0) + 1);
    for (const m of text.matchAll(/@keyframes\s+([\w-]+)/g)) anims.set(`keyframes:${m[1]}`, (anims.get(`keyframes:${m[1]}`) ?? 0) + 1);
    for (const m of text.matchAll(/\b(?:MotiView|MotiText|AnimatePresence|motion\.[a-z]+|Animated\.[A-Za-z]+)/g)) anims.set(m[0], (anims.get(m[0]) ?? 0) + 1);
    for (const m of text.matchAll(/font-?(?:family|Family)?['"]?\s*[:=]\s*['"]([^'";}]+)['"]/g)) fonts.set(m[1], (fonts.get(m[1]) ?? 0) + 1);
    for (const m of text.matchAll(/from\s+['"][^'"]*(tailwindcss|nativewind)|lucide-(?:react|react-native)['"];?\s*$/gm)) {
      void m;
    }
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide[^'"]*['"]/g)) {
      for (const icon of m[1].split(',')) icons.set(icon.trim(), 1);
    }
  }
  const firstPrompt = (state.messages ?? []).find((m) => m.role === 'user')?.text ?? '';
  return `# Spec de diseño — ${name || 'sin nombre'} (\`${kind}\`)

- **kind**: ${kind}
- **archivado**: ${new Date().toISOString()}
${description ? `- **descripción**: ${description}` : ''}

## Prompt original (primer mensaje del usuario)

${firstPrompt || '(vacío)'}

## Paleta (hex detectados, por frecuencia)

${topCounts(colors).map((c) => `- \`${c}\``).join('\n') || '- (ninguno)'}

## Animaciones / transiciones

${topCounts(anims, 18).map((a) => `- \`${a}\``).join('\n') || '- (ninguna detectada)'}

## Tipografías

${topCounts(fonts, 8).map((f) => `- ${f}`).join('\n') || '- (default del stack)'}

## Iconos lucide usados

${[...icons.keys()].slice(0, 20).join(', ') || '(ninguno)'}

## Estructura de archivos

${files.slice(0, 40).map((f) => `- \`${f}\``).join('\n')}
`;
}

// Screenshot del preview — Playwright es dep OPCIONAL: si no está
// instalado (o falla el launch), devuelve skipped y el archive sigue
// sin imagen. El iframe del dashboard no sirve (cross-origin).
export async function captureScreenshot(url, dest, { mobile = false } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { ok: false, skipped: 'playwright no instalado' };
  }
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000); // animaciones de entrada / HMR
    await page.screenshot({ path: dest });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await browser?.close().catch(() => {});
  }
}

// Archiva una sesión de diseño: copia el workspace a
// design-library/<slug>/workspace/ + meta/state/spec + screenshot si
// hay preview vivo. El CALLER borra el workspace original tras ok.
export async function archiveWorkspace({
  kind,
  workDir,
  statePath,
  slug = '',
  name = '',
  description = '',
  previewUrl = null,
  libDir = LIBRARY_DIR,
} = {}) {
  if (!existsSync(join(workDir, 'package.json'))) {
    return { ok: false, error: 'no hay diseño para archivar' };
  }
  let state = { messages: [] };
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch { /* sesión sin state — igual archiva */ }
  const firstUser = (state.messages ?? []).find((m) => m.role === 'user')?.text ?? '';
  const finalSlug = slug && LIB_SLUG_RE.test(slug)
    ? uniqueSlug(slug, libDir)
    : uniqueSlug(slugify(name || firstUser || `${kind}-design`), libDir);
  const dir = entryDir(finalSlug, libDir);
  mkdirSync(join(dir, 'workspace'), { recursive: true });
  cpSync(workDir, join(dir, 'workspace'), {
    recursive: true,
    filter: (src) => !ARCHIVE_EXCLUDE.has(basename(src)),
  });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2));
  const meta = {
    slug: finalSlug,
    kind,
    name: name || firstUser.slice(0, 80) || finalSlug,
    description: description || '',
    created: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(
    join(dir, 'spec.md'),
    makeSpec({ workDir, kind, state, name: meta.name, description }),
  );
  let shot = { ok: false };
  if (previewUrl) {
    shot = await captureScreenshot(previewUrl, join(dir, 'screenshot.png'), {
      mobile: kind === 'mobile',
    });
  }
  return { ok: true, slug: finalSlug, screenshot: shot.ok ? 'captured' : (shot.skipped ?? 'no-preview') };
}

// Restaura una entrada a su workspace de sesión (same-kind). El
// caller valida que el workDir esté libre y dispara startInstall.
export function restoreWorkspace({ slug, kind, workDir, statePath, libDir = LIBRARY_DIR } = {}) {
  const meta = getEntry(slug, libDir);
  if (!meta) return { ok: false, error: `no existe el diseño ${slug}` };
  if (meta.kind !== kind) {
    return {
      ok: false,
      error: `${slug} es un diseño ${meta.kind === 'mobile' ? 'mobile' : 'web'} — restauralo desde su tab`,
    };
  }
  const src = join(entryDir(slug, libDir), 'workspace');
  if (!existsSync(src)) return { ok: false, error: `${slug} no tiene workspace archivado` };
  mkdirSync(workDir, { recursive: true });
  cpSync(src, workDir, { recursive: true });
  try {
    const st = readFileSync(join(entryDir(slug, libDir), 'state.json'), 'utf8');
    writeFileSync(statePath, st);
  } catch {
    writeFileSync(statePath, JSON.stringify({ messages: [], created: new Date().toISOString() }));
  }
  return { ok: true, slug };
}

// Copia la entrada como .reference/<slug>/ dentro de un workspace
// nuevo — el agente lee estilos/animaciones/componentes exactos.
// Cross-kind permitido: la referencia es lectura, no restore.
export function copyReference(slug, workDir, libDir = LIBRARY_DIR) {
  const dir = entryDir(slug, libDir);
  const src = join(dir, 'workspace');
  if (!existsSync(src)) return { ok: false, error: `${slug} no tiene workspace` };
  const dest = join(workDir, '.reference', slug);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  const spec = join(dir, 'spec.md');
  if (existsSync(spec)) cpSync(spec, join(dest, 'SPEC.md'));
  return { ok: true, path: `.reference/${slug}` };
}

// Bloque de contexto para el prompt del agente — mismo patrón que
// apiContextBlock: spec + dónde leer el código original.
export function referenceBlock(slug, libDir = LIBRARY_DIR) {
  const meta = getEntry(slug, libDir);
  if (!meta) return '';
  let spec = '';
  try {
    spec = readFileSync(join(entryDir(slug, libDir), 'spec.md'), 'utf8');
  } catch { /* sin spec — igual apunta al código */ }
  return (
    `\n\n## Diseño de referencia archivado: ${meta.name} (${slug}, kind: ${meta.kind})\n` +
    `El usuario quiere reutilizar estilos/animaciones/componentes de este diseño.\n` +
    `El código original completo está en \`.reference/${slug}/\` dentro de tu workspace — ` +
    `leé los archivos que necesites para copiar estilos, animaciones o componentes exactos.\n\n` +
    (spec ? `${spec}\n` : '')
  );
}

export function deleteEntry(slug, libDir = LIBRARY_DIR) {
  const dir = entryDir(slug, libDir);
  if (!LIB_SLUG_RE.test(slug ?? '') || !existsSync(dir)) {
    return { ok: false, error: `no existe el diseño ${slug}` };
  }
  rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}
