import { describe, expect, it } from 'vitest';
import { validatePlan } from '../src/agents/validator.js';
import { applyCompliance, complianceFor } from '../src/compliance/index.js';
import { verticals } from '../src/verticals/index.js';

const baseStep = {
  id: 1,
  type: 'infra',
  description: 'init vite react tailwind',
  verify: 'npm run build',
  status: 'pending',
  attempts: 0,
};
const plan = (steps) => ({ projectName: 't', scope: 'frontend', appType: 'x', steps });

describe('validatePlan — reglas de schema', () => {
  it('plan ausente/inválido', () => {
    expect(validatePlan(null, 'frontend')).toEqual(['plan.json ausente o inválido']);
    expect(validatePlan({}, 'frontend')).toContain('falta projectName');
  });

  it('paso sin verify ejecutable', () => {
    const errs = validatePlan(plan([{ ...baseStep, verify: '' }]), 'frontend');
    expect(errs.some((e) => e.includes('verify'))).toBe(true);
  });

  it('type inválido', () => {
    const errs = validatePlan(plan([{ ...baseStep, type: 'magico' }]), 'frontend');
    expect(errs.some((e) => e.includes('type inválido'))).toBe(true);
  });
});

describe('validatePlan — plan.validated (confianza)', () => {
  it('validated:true salta requirements pero no el schema', () => {
    // El plan sintético de saveDesign: un solo paso done que nunca
    // pasaría los requirements (vite/e2e/vitest/privacidad) — con
    // validated:true se acepta porque los pasos ya están construidos.
    const p = plan([{ ...baseStep, description: 'diseño iterado en chat', status: 'done' }]);
    expect(validatePlan(p, 'frontend').length).toBeGreaterThan(0);
    expect(validatePlan({ ...p, validated: true }, 'frontend')).toEqual([]);
    // schema roto sigue fallando aun con validated
    expect(validatePlan({ validated: true, steps: [] }, 'frontend')).not.toEqual([]);
  });
});

describe('validatePlan — restricciones de scope', () => {
  const okSteps = [
    { ...baseStep, id: 1, description: 'init con vite' },
    { ...baseStep, id: 2, type: 'frontend', description: 'UI con reglas de ui + privacidad y consentimiento + página 404' },
    { ...baseStep, id: 3, type: 'test', description: 'tests con vitest', verify: 'npx vitest run' },
    { ...baseStep, id: 4, type: 'e2e', description: 'specs playwright', verify: 'npm run test:e2e' },
  ];

  it('scope frontend completo → válido', () => {
    expect(validatePlan(plan(okSteps), 'frontend')).toEqual([]);
  });

  it('scope backend no admite pasos frontend/e2e', () => {
    const steps = [
      { ...baseStep, id: 1, type: 'backend', description: 'api express con sqlite', verify: 'npx vitest run' },
      { ...baseStep, id: 2, type: 'frontend', description: 'ui' },
    ];
    const errs = validatePlan(plan(steps), 'backend');
    expect(errs).toContain('scope backend no debe incluir pasos frontend/e2e');
  });

  it('scope con backend exige express + sqlite', () => {
    const steps = [{ ...baseStep, id: 1, type: 'backend', description: 'api generica', verify: 'npx vitest run' }];
    const errs = validatePlan(plan(steps), 'backend');
    expect(errs).toContain('falta paso de Express');
    expect(errs).toContain('falta paso de SQLite');
  });

  it('falta paso test con vitest → error', () => {
    const steps = okSteps.filter((s) => s.type !== 'test');
    expect(validatePlan(plan(steps), 'frontend')).toContain('falta paso test con Vitest');
  });
});

describe('verticales — buildPlan() siempre produce planes válidos', () => {
  // El path real del planner: buildPlan → applyCompliance → validatePlan
  // (el registry inyecta los bloques base — p.ej. 404 — que buildPlan
  // no declara por sí solo).
  const planOf = (v, opts, scope) => {
    const p = verticals[v].buildPlan({ projectName: 't', phone: '', ...opts, scope });
    applyCompliance(p, complianceFor({ idea: opts.idea, scope }));
    return p;
  };

  it('orders: los 3 scopes validan', () => {
    for (const scope of ['fullstack', 'frontend', 'backend']) {
      const p = planOf('orders', { idea: 'pizzería' }, scope);
      expect(validatePlan(p, scope), `scope ${scope}`).toEqual([]);
    }
  });

  it('landing: valida con su scope forzado', () => {
    const p = planOf('landing', { idea: 'café' }, 'frontend');
    expect(validatePlan(p, p.scope)).toEqual([]);
  });

  it('blog: los 3 scopes validan', () => {
    for (const scope of ['fullstack', 'frontend', 'backend']) {
      const p = planOf('blog', { idea: 'blog de recetas' }, scope);
      expect(validatePlan(p, scope), `scope ${scope}`).toEqual([]);
    }
  });
});
