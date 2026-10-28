import { describe, expect, it } from 'vitest';
import { normalizeExtendedPlan } from '../src/tools/extend-plan.js';

const doneFrontend = (desc = 'UI implementada sobre Vite + React + Tailwind aplicando las reglas de UI del AGENTS.md') => ({
  id: 1,
  type: 'frontend',
  description: desc,
  verify: 'npm run build',
  status: 'done',
  attempts: 1,
});
const backendStep = (id) => ({
  id,
  type: 'backend',
  description: 'rutas express + schema sqlite, arquitectura flat',
  verify: 'npm run build',
  status: 'pending',
  attempts: 0,
});
const plan = (steps) => ({
  projectName: 'app',
  scope: 'frontend',
  appType: 'custom',
  validated: true,
  steps,
});

describe('normalizeExtendedPlan', () => {
  it('scope→fullstack, validated=false, stacks rellenados', () => {
    const p = normalizeExtendedPlan(plan([doneFrontend(), backendStep(2)]));
    expect(p.scope).toBe('fullstack');
    expect(p.validated).toBe(false);
    expect(p.stacks.backend).toBe('express-sqlite');
    expect(p.stacks.frontend).toBe('vite-react');
  });

  it('respeta stacks existentes del plan', () => {
    const p = plan([doneFrontend(), backendStep(2)]);
    p.stacks = { frontend: 'nextjs', backend: null };
    normalizeExtendedPlan(p);
    expect(p.stacks.frontend).toBe('nextjs');
    expect(p.stacks.backend).toBe('express-sqlite');
  });

  it('parchea descripciones frontend sin keywords (done legacy de saveDesign)', () => {
    const p = normalizeExtendedPlan(plan([doneFrontend('diseño iterado en chat'), backendStep(2)]));
    expect(p.steps[0].description).toContain('reglas de UI');
    expect(p.steps[0].description).toContain('Vite');
    // el ya-compliant no se toca dos veces
    const p2 = normalizeExtendedPlan(plan([doneFrontend(), backendStep(2)]));
    expect(p2.steps[0].description.match(/reglas de UI/g)).toHaveLength(1);
  });

  it('renumera ids y sanea status/attempts', () => {
    const p = normalizeExtendedPlan(
      plan([doneFrontend(), { ...backendStep(99), status: undefined, attempts: undefined }]),
    );
    expect(p.steps.map((s) => s.id)).toEqual([1, 2]);
    expect(p.steps[1].status).toBe('pending');
    expect(p.steps[1].attempts).toBe(0);
  });
});
