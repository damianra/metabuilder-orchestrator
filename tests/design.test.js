import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Solo asserts de lectura: DESIGN_DIR apunta a <repo>/design-work y un
// test que toque create/discard podría borrar una sesión real en curso.
import { DESIGN_DIR, designStatus } from '../src/design/session.js';

describe('design session', () => {
  it('designStatus responde el contrato exists/messages', () => {
    const s = designStatus();
    expect(typeof s.exists).toBe('boolean');
    expect(Array.isArray(s.messages)).toBe(true);
    if (!s.exists) expect(s.messages).toEqual([]);
  });

  it('DESIGN_DIR vive fuera de generated-apps (no aparece como proyecto)', () => {
    expect(DESIGN_DIR.endsWith('design-work')).toBe(true);
    expect(DESIGN_DIR).not.toContain('generated-apps');
  });
});

