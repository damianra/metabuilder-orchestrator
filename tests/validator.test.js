import { describe, expect, it } from 'vitest';
import { validatePlan } from '../src/agents/validator.js';
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

describe('validatePlan — restricciones de scope', () => {
  const okSteps = [
    { ...baseStep, id: 1, description: 'init con vite' },
    { ...baseStep, id: 2, type: 'frontend', description: 'UI con reglas de ui + privacidad y consentimiento' },
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
  it('orders: los 3 scopes validan', () => {
    for (const scope of ['fullstack', 'frontend', 'backend']) {
      const p = verticals.orders.buildPlan({ projectName: 't', idea: 'pizzería', scope, phone: '' });
      expect(validatePlan(p, scope), `scope ${scope}`).toEqual([]);
    }
  });

  it('landing: valida con su scope forzado', () => {
    const p = verticals.landing.buildPlan({ projectName: 't', idea: 'café', phone: '' });
    expect(validatePlan(p, p.scope)).toEqual([]);
  });

  it('blog: los 3 scopes validan', () => {
    for (const scope of ['fullstack', 'frontend', 'backend']) {
      const p = verticals.blog.buildPlan({ projectName: 't', idea: 'blog de recetas', scope });
      expect(validatePlan(p, scope), `scope ${scope}`).toEqual([]);
    }
  });
});
