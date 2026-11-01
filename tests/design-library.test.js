import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Biblioteca de diseños (v15) — todos los casos usan libDir/workDir
// inyectados en tmpdir para no tocar design-library/ ni los workspaces
// reales de sesión.
import {
  archiveWorkspace,
  captureScreenshot,
  copyReference,
  deleteEntry,
  getEntry,
  LIBRARY_DIR,
  listLibrary,
  makeSpec,
  nextDesignName,
  readPrompt,
  referenceBlock,
  restoreWorkspace,
  slugify,
  waitForUrl,
} from '../src/design/library.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'mb-lib-'));
const tmps = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Workdir mínimo: package.json + un source file con estilos.
const makeWork = (dir, state = null) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{}');
  writeFileSync(
    join(dir, 'src', 'App.jsx'),
    `export default () => <div className="bg-[#1a2b3c] animate-pulse">hi</div>`,
  );
  writeFileSync(
    join(dir, 'design-state.json'),
    JSON.stringify(state ?? {
      messages: [
        { role: 'user', text: 'Quiero una landing oscura azul' },
        { role: 'agent', text: 'listo' },
      ],
      created: '2026-01-01T00:00:00Z',
      frontendStackId: 'vite-react',
    }),
  );
};

describe('design library', () => {
  it('LIBRARY_DIR vive en el root del repo y fuera de generated-apps', () => {
    expect(LIBRARY_DIR.endsWith('design-library')).toBe(true);
    expect(LIBRARY_DIR).not.toContain('generated-apps');
  });

  it('slugify normaliza acentos y caracteres raros', () => {
    expect(slugify('Mi Diseño de Hábitos!')).toBe('mi-diseno-de-habitos');
    expect(slugify('   ')).toBe('diseno');
    expect(slugify('Café — v2')).toBe('cafe-v2');
  });

  it('archive crea meta/state/spec/workspace y excluye node_modules', async () => {
    const libDir = tmp();
    const work = tmp();
    tmps.push(libDir, work);
    makeWork(work);
    mkdirSync(join(work, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(work, 'node_modules', 'x', 'i.js'), 'x');

    const r = await archiveWorkspace({
      kind: 'web',
      workDir: work,
      statePath: join(work, 'design-state.json'),
      libDir,
    });
    expect(r.ok).toBe(true);
    const dir = join(libDir, r.slug);
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    expect(meta.kind).toBe('web');
    // Sin nombre → genérico Diseño NNN (v15.1 — ya no usa el primer
    // mensaje del chat, que dejaba nombres ilegibles).
    expect(meta.name).toBe('Diseño 001');
    expect(existsSync(join(dir, 'state.json'))).toBe(true);
    expect(existsSync(join(dir, 'spec.md'))).toBe(true);
    expect(existsSync(join(dir, 'workspace', 'src', 'App.jsx'))).toBe(true);
    expect(existsSync(join(dir, 'workspace', 'node_modules'))).toBe(false);
    expect(readFileSync(join(dir, 'spec.md'), 'utf8')).toContain('#1a2b3c');
  });

  it('archive sin nombre asigna Diseño NNN y el nombre propio manda', async () => {
    const libDir = tmp();
    const work = tmp();
    const work2 = tmp();
    const work3 = tmp();
    tmps.push(libDir, work, work2, work3);
    makeWork(work);
    makeWork(work2);
    makeWork(work3);
    expect(nextDesignName(libDir)).toBe('Diseño 001');
    const r1 = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'design-state.json'), libDir });
    expect(r1.slug).toBe('diseno-001');
    expect(nextDesignName(libDir)).toBe('Diseño 002');
    const r2 = await archiveWorkspace({ kind: 'web', workDir: work2, statePath: join(work2, 'design-state.json'), libDir });
    expect(r2.slug).toBe('diseno-002');
    // Nombre propio → slug del nombre, la secuencia genérica no avanza
    const r3 = await archiveWorkspace({ kind: 'web', workDir: work3, statePath: join(work3, 'design-state.json'), name: 'Mi Landing', libDir });
    expect(r3.slug).toBe('mi-landing');
    expect(getEntry(r3.slug, libDir).name).toBe('Mi Landing');
    expect(nextDesignName(libDir)).toBe('Diseño 003');
  });

  it('archive falla sin workspace', async () => {
    const libDir = tmp();
    const work = tmp();
    tmps.push(libDir, work);
    const r = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'x.json'), libDir });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no hay diseño/);
  });

  it('list devuelve entradas ordenadas con flags hasSpec/hasShot', async () => {
    const libDir = tmp();
    const work = tmp();
    tmps.push(libDir, work);
    makeWork(work);
    await archiveWorkspace({ kind: 'mobile', workDir: work, statePath: join(work, 'design-state.json'), libDir });
    const items = listLibrary(libDir);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('mobile');
    expect(items[0].hasSpec).toBe(true);
    expect(items[0].hasShot).toBe(false); // sin preview → sin screenshot
  });

  it('restore devuelve workspace+state y valida kind', async () => {
    const libDir = tmp();
    const work = tmp();
    const dest = join(tmp(), 'restore-dest');
    tmps.push(libDir, work, dest);
    makeWork(work);
    const r = await archiveWorkspace({ kind: 'mobile', workDir: work, statePath: join(work, 'design-state.json'), libDir });

    // cross-kind → error
    const bad = restoreWorkspace({ slug: r.slug, kind: 'web', workDir: dest, statePath: join(dest, 'design-state.json'), libDir });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/mobile/);

    const ok = restoreWorkspace({ slug: r.slug, kind: 'mobile', workDir: dest, statePath: join(dest, 'mobile-state.json'), libDir });
    expect(ok.ok).toBe(true);
    expect(existsSync(join(dest, 'src', 'App.jsx'))).toBe(true);
    const st = JSON.parse(readFileSync(join(dest, 'mobile-state.json'), 'utf8'));
    expect(st.messages).toHaveLength(2);
  });

  it('copyReference copia workspace+SPEC a .reference/ aun cross-kind', async () => {
    const libDir = tmp();
    const work = tmp();
    const dest = join(tmp(), 'new-work');
    tmps.push(libDir, work, dest);
    makeWork(work);
    const r = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'design-state.json'), libDir });
    mkdirSync(dest, { recursive: true });
    const c = copyReference(r.slug, dest, libDir);
    expect(c.ok).toBe(true);
    expect(existsSync(join(dest, '.reference', r.slug, 'src', 'App.jsx'))).toBe(true);
    expect(existsSync(join(dest, '.reference', r.slug, 'SPEC.md'))).toBe(true);
  });

  it('referenceBlock inyecta spec + puntero a .reference', async () => {
    const libDir = tmp();
    const work = tmp();
    tmps.push(libDir, work);
    makeWork(work);
    const r = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'design-state.json'), libDir });
    const block = referenceBlock(r.slug, libDir);
    expect(block).toContain(`.reference/${r.slug}/`);
    expect(block).toContain('Spec de diseño');
    expect(referenceBlock('no-existe', libDir)).toBe('');
  });

  it('restore re-hidrata .reference/ si el state archivado la tenía', async () => {
    const libDir = tmp();
    const refWork = tmp();
    const work = tmp();
    const dest = join(tmp(), 'restore-ref');
    tmps.push(libDir, refWork, work, dest);
    makeWork(refWork);
    const ref = await archiveWorkspace({ kind: 'web', workDir: refWork, statePath: join(refWork, 'design-state.json'), libDir });
    // Segunda sesión que usaba la primera como referencia
    makeWork(work, {
      messages: [{ role: 'user', text: 'otro' }],
      reference: ref.slug,
      frontendStackId: 'vite-react',
    });
    const r = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'design-state.json'), libDir });
    const ok = restoreWorkspace({ slug: r.slug, kind: 'web', workDir: dest, statePath: join(dest, 'design-state.json'), libDir });
    expect(ok.ok).toBe(true);
    expect(existsSync(join(dest, '.reference', ref.slug, 'src', 'App.jsx'))).toBe(true);
  });

  it('deleteEntry borra la entrada y valida slug', async () => {
    const libDir = tmp();
    const work = tmp();
    tmps.push(libDir, work);
    makeWork(work);
    const r = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'design-state.json'), libDir });
    expect(deleteEntry(r.slug, libDir).ok).toBe(true);
    expect(existsSync(join(libDir, r.slug))).toBe(false);
    expect(deleteEntry('no-existe', libDir).ok).toBe(false);
    expect(deleteEntry('../etc', libDir).ok).toBe(false);
  });

  it('makeSpec resume paleta, animaciones y estructura', () => {
    const work = tmp();
    tmps.push(work);
    makeWork(work);
    const spec = makeSpec({ workDir: work, kind: 'web', state: { messages: [{ role: 'user', text: 'test' }] }, name: 't' });
    expect(spec).toContain('#1a2b3c');
    expect(spec).toContain('animate-pulse');
    expect(spec).toContain('src/App.jsx');
    expect(spec).toContain('test');
  });

  it('getEntry devuelve null para slugs inválidos o inexistentes', () => {
    const libDir = tmp();
    tmps.push(libDir);
    expect(getEntry('../escape', libDir)).toBeNull();
    expect(getEntry('nope', libDir)).toBeNull();
  });

  it('readPrompt sirve prompt.md del agente, fallback a spec.md, null si no hay nada', async () => {
    const libDir = tmp();
    const work = tmp();
    tmps.push(libDir, work);
    makeWork(work);
    const r = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'design-state.json'), libDir });

    // Sin prompt.md → fallback a spec.md
    const fallback = readPrompt(r.slug, libDir);
    expect(fallback.source).toBe('spec');
    expect(fallback.text).toContain('Spec de diseño');

    // Con prompt.md → source 'agent' (así lo escribe writeDesignPrompt)
    writeFileSync(join(libDir, r.slug, 'prompt.md'), '# Sistema de diseño — reglas');
    const agent = readPrompt(r.slug, libDir);
    expect(agent.source).toBe('agent');
    expect(agent.text).toContain('Sistema de diseño');

    expect(readPrompt('no-existe', libDir)).toBeNull();
    expect(readPrompt('../etc', libDir)).toBeNull();
  });

  it('waitForUrl devuelve la URL cuando el status está listo y null en timeout', async () => {
    const ready = await waitForUrl(() => ({ devRunning: true, urls: ['http://127.0.0.1:5173'] }), 2000);
    expect(ready).toBe('http://127.0.0.1:5173');
    const none = await waitForUrl(() => ({ devRunning: false, urls: [] }), 50);
    expect(none).toBeNull();
  });

  it('captureScreenshot resuelve playwright del workspace (skipped vs error)', async () => {
    const work = tmp();
    tmps.push(work);
    // Fake playwright module en el node_modules del workspace
    const modDir = join(work, 'node_modules', 'playwright');
    mkdirSync(modDir, { recursive: true });
    writeFileSync(join(modDir, 'package.json'), '{"name":"playwright","main":"index.js"}');
    writeFileSync(join(modDir, 'index.js'), 'module.exports = { chromium: "fake" };');
    // Resuelve el módulo → intenta chromium.launch() (es un string) →
    // error de launch, NO skipped — prueba que la resolución funciona.
    const r = await captureScreenshot('http://127.0.0.1:1', join(work, 's.png'), { workDir: work });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBeUndefined();
    expect(r.error).toBeTruthy();
    // Sin módulo en el workspace y sin playwright en el root → skipped
    const empty = tmp();
    tmps.push(empty);
    const r2 = await captureScreenshot('http://127.0.0.1:1', join(empty, 's.png'), { workDir: empty });
    expect(r2.ok).toBe(false);
    expect(r2.skipped).toBe('playwright no instalado');
  });
});
