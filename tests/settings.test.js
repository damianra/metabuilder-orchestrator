import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSettings, writeSettings } from '../src/tools/settings.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'mb-settings-')), 'settings.json');

describe('settings.json', () => {
  it('archivo ausente → {} sin lanzar', () => {
    expect(readSettings(tmp())).toEqual({});
  });

  it('JSON inválido → {} sin lanzar', () => {
    const p = tmp();
    writeFileSync(p, '{no json');
    expect(readSettings(p)).toEqual({});
  });

  it('write mergea y persiste (atomic tmp + rename)', () => {
    const p = tmp();
    writeSettings({ engine: 'opencode' }, p);
    writeSettings({ extra: 1 }, p);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(s).toEqual({ engine: 'opencode', extra: 1 });
    // el rename no deja el .tmp tirado
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });
});
