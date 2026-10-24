import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectDir, slugify } from '../src/tools/slug.js';

describe('slugify', () => {
  it('normaliza acentos, espacios y símbolos', () => {
    expect(slugify('Tienda Café Ñandú!!!')).toBe('tienda-cafe-nandu');
    expect(slugify('  Casa--Comidas  ')).toBe('casa-comidas');
  });

  it('string vacío o sin caracteres válidos → app', () => {
    expect(slugify('')).toBe('app');
    expect(slugify('###')).toBe('app');
  });

  it('corta a 50 caracteres', () => {
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(50);
  });
});

describe('ensureProjectDir', () => {
  it('crea el dir y sufija si ya existe', () => {
    const base = mkdtempSync(join(tmpdir(), 'mb-slug-'));
    const a = ensureProjectDir(base, 'Mi App');
    expect(a.slug).toBe('mi-app');
    const b = ensureProjectDir(base, 'Mi App');
    expect(b.slug).toBe('mi-app-2');
    const c = ensureProjectDir(base, 'Mi App');
    expect(c.slug).toBe('mi-app-3');
  });
});
