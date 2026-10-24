import { describe, expect, it } from 'vitest';
import { extractVerdictComment } from '../src/validate-pr.js';

describe('extractVerdictComment', () => {
  it('extrae solo el bloque de veredicto, sin la narración', () => {
    const res = {
      ok: true,
      text: 'Voy a revisar el diff. Leí archivos.\n\n## Validación funcional (sub-agente)\n- Qué se corrió: npm test\n- Resultado: 42/42\n- Veredicto: ✅ APROBADO PARA MERGE',
    };
    const out = extractVerdictComment(res);
    expect(out.startsWith('## Validación funcional')).toBe(true);
    expect(out).not.toContain('Voy a revisar');
    expect(out).toContain('APROBADO PARA MERGE');
  });

  it('error del agente → requiere revisión', () => {
    const out = extractVerdictComment({ ok: false, error: 'timeout' });
    expect(out).toContain('timeout');
    expect(out).toContain('⚠️ REQUIERE REVISIÓN');
  });

  it('sin bloque de veredicto → requiere revisión con la salida', () => {
    const out = extractVerdictComment({ ok: true, text: 'no encontré nada claro' });
    expect(out).toContain('⚠️ REQUIERE REVISIÓN');
    expect(out).toContain('no devolvió el bloque');
  });
});
