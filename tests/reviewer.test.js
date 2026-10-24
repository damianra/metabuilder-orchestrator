import { describe, expect, it } from 'vitest';
import { parseReviewResult } from '../src/agents/reviewer.js';

describe('parseReviewResult', () => {
  it('RESULT: APPROVED → approved (variantes de formato)', () => {
    for (const t of ['RESULT: APPROVED', 'result:approved', 'bla bla\nRESULT:   APPROVED\nfin']) {
      expect(parseReviewResult(t).approved).toBe(true);
    }
  });

  it('RESULT: ISSUES → extrae el detalle', () => {
    const r = parseReviewResult('análisis...\nRESULT: ISSUES\n- falta fallback\n- botón roto');
    expect(r.approved).toBe(false);
    expect(r.issues).toContain('falta fallback');
  });

  it('sin marcador → issues = texto completo', () => {
    const r = parseReviewResult('no pude revisar nada');
    expect(r.approved).toBe(false);
    expect(r.issues).toBe('no pude revisar nada');
  });
});
