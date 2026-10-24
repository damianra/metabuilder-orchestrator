import { describe, expect, it } from 'vitest';
import { extractVerdictComment, prNeedsValidation } from '../src/validate-pr.js';

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

describe('prNeedsValidation — detección de PRs pendientes', () => {
  const HEAD = 'abc1234deadbeef';
  const verdict = (sha) => ({
    body: `## Validación funcional (sub-agente)\n✅ APROBADO\n\n<!-- validate-pr head:${sha.slice(0, 7)} -->`,
  });

  it('sin comentarios → pendiente', () => {
    expect(prNeedsValidation([], HEAD)).toBe(true);
  });

  it('con veredicto del head actual → no pendiente', () => {
    expect(prNeedsValidation([verdict(HEAD)], HEAD)).toBe(false);
  });

  it('veredicto de un head viejo (push nuevo) → pendiente', () => {
    expect(prNeedsValidation([verdict('fffff00aaa')], HEAD)).toBe(true);
  });

  it('comentario de veredicto sin tag de sha → pendiente', () => {
    const c = [{ body: '## Validación funcional (sub-agente)\n✅ APROBADO PARA MERGE' }];
    expect(prNeedsValidation(c, HEAD)).toBe(true);
  });

  it('comentarios ajenos al veredicto no cuentan', () => {
    const c = [{ body: 'lgtm!' }, { body: '## Validación funcional manual sin tag' }];
    expect(prNeedsValidation(c, HEAD)).toBe(true);
  });
});
