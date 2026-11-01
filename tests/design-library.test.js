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
  copyReference,
  deleteEntry,
  getEntry,
  LIBRARY_DIR,
  listLibrary,
  makeSpec,
  referenceBlock,
  restoreWorkspace,
  slugify,
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
    expect(meta.name).toBe('Quiero una landing oscura azul');
    expect(existsSync(join(dir, 'state.json'))).toBe(true);
    expect(existsSync(join(dir, 'spec.md'))).toBe(true);
    expect(existsSync(join(dir, 'workspace', 'src', 'App.jsx'))).toBe(true);
    expect(existsSync(join(dir, 'workspace', 'node_modules'))).toBe(false);
    expect(readFileSync(join(dir, 'spec.md'), 'utf8')).toContain('#1a2b3c');
  });

  it('archive deriva slug del primer mensaje y deduplica', async () => {
    const libDir = tmp();
    const work = tmp();
    const work2 = tmp();
    tmps.push(libDir, work, work2);
    makeWork(work);
    makeWork(work2);
    const r1 = await archiveWorkspace({ kind: 'web', workDir: work, statePath: join(work, 'design-state.json'), libDir });
    const r2 = await archiveWorkspace({ kind: 'web', workDir: work2, statePath: join(work2, 'design-state.json'), libDir });
    expect(r1.slug).toBe('quiero-una-landing-oscura-azul');
    expect(r2.slug).toBe('quiero-una-landing-oscura-azul-2');
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
});
