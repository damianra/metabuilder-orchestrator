import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';

// Regresión: un run de 8 pasos + repair + review aprobado moría con
// "loop review/fix agotó el límite" — el recursionLimit default de
// LangGraph (25) queda chico para ~26 super-steps. El runner pasa
// config.graphRecursionLimit en el stream call (index.js).
describe('graph recursion limit', () => {
  it('config expone un piso seguro por encima del default de LangGraph', () => {
    expect(Number.isInteger(config.graphRecursionLimit)).toBe(true);
    // piso: 8 pasos × (build+verify) + ~10 nodos fijos + rondas
    // review↔fix con margen — nunca debe bajar del default (25).
    expect(config.graphRecursionLimit).toBeGreaterThanOrEqual(50);
  });
});
