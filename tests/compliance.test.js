import { describe, expect, it } from 'vitest';
import {
  applyCompliance,
  complianceFor,
  complianceRequirements,
  complianceRuleBullets,
  getCompliance,
  listCompliance,
  resolveCompliance,
} from '../src/compliance/index.js';
import { validatePlan } from '../src/agents/validator.js';

const step = (type, description = 'x') => ({
  id: 1,
  type,
  description,
  verify: 'npm run build',
  status: 'pending',
  attempts: 0,
});

describe('compliance registry', () => {
  it('expone los 6 perfiles con requirements', () => {
    expect(listCompliance().sort()).toEqual(
      ['auth', 'cookies', 'notfound', 'pagos', 'privacidad', 'terminos'].sort(),
    );
    for (const id of listCompliance()) {
      expect(getCompliance(id).requirements.length).toBeGreaterThan(0);
    }
  });

  it('base siempre aplica con frontend; scope backend la omite', () => {
    expect(resolveCompliance({ idea: 'x', scope: 'fullstack' })).toEqual([
      'privacidad',
      'notfound',
    ]);
    expect(resolveCompliance({ idea: 'x', scope: 'frontend' })).toContain('notfound');
    // backend sin frontend: ni privacidad ni 404 — pero sí puede inferir auth
    const ids = resolveCompliance({ idea: 'api con login de usuarios', scope: 'backend' });
    expect(ids).not.toContain('privacidad');
    expect(ids).not.toContain('notfound');
    expect(ids).toContain('auth');
  });

  it('infiere perfiles por la idea (sin que el usuario los pida)', () => {
    const tienda = resolveCompliance({ idea: 'tienda online con checkout', scope: 'fullstack' });
    expect(tienda).toContain('terminos');
    expect(tienda).toContain('pagos');
    expect(tienda).toContain('privacidad');
    expect(resolveCompliance({ idea: 'app con google analytics', scope: 'frontend' })).toContain(
      'cookies',
    );
    expect(resolveCompliance({ idea: 'área de miembros con registro', scope: 'fullstack' })).toContain(
      'auth',
    );
  });

  it('flag explícito suma perfiles y rechaza ids inválidos', () => {
    const ids = resolveCompliance({ idea: 'x', scope: 'fullstack', flag: 'cookies' });
    expect(ids).toContain('cookies');
    expect(ids).toContain('privacidad'); // base nunca se quita
    expect(() => resolveCompliance({ flag: 'magia' })).toThrow('compliance desconocido');
    // auth en scope frontend queda filtrado (no hay backend para sesiones)
    expect(resolveCompliance({ scope: 'frontend', flag: 'auth' })).not.toContain('auth');
  });

  it('complianceFor: flag > plan persistido > inferencia', () => {
    expect(complianceFor({ flag: 'cookies', scope: 'fullstack' })).toContain('cookies');
    expect(complianceFor({ plan: { compliance: ['terminos'] }, scope: 'fullstack' })).toEqual([
      'terminos',
    ]);
    expect(complianceFor({ idea: 'blog', scope: 'fullstack' })).toContain('privacidad');
  });

  it('applyCompliance inyecta solo lo no cubierto y persiste plan.compliance', () => {
    const plan = {
      steps: [
        step('infra'),
        step('frontend', 'UI con reglas de ui y privacidad y consentimiento'),
        step('test'),
      ],
    };
    applyCompliance(plan, ['privacidad', 'notfound']);
    // privacidad ya está cubierta → no duplica; notfound se inyecta en el primer frontend
    const frontend = plan.steps[1];
    expect(frontend.description.match(/privacidad/g).length).toBe(1);
    expect(frontend.description).toContain('404');
    expect(plan.compliance).toEqual(['privacidad', 'notfound']);
    // idempotente: segunda pasada no re-appenda
    applyCompliance(plan, ['notfound']);
    expect(plan.steps[1].description.match(/404/g).length).toBe(1);
  });

  it('applyCompliance auth apunta a un paso backend', () => {
    const plan = { steps: [step('frontend'), step('backend', 'api express sqlite')] };
    applyCompliance(plan, ['auth']);
    expect(plan.steps[1].description).toContain('httpOnly');
    expect(plan.steps[0].description).not.toContain('httpOnly');
  });

  it('validator exige los perfiles activos del plan', () => {
    const plan = {
      projectName: 't',
      idea: 'x',
      compliance: ['privacidad', 'notfound'],
      steps: [
        step('infra', 'init vite react tailwind'),
        step('frontend', 'UI con reglas de ui'),
        step('test', 'suite Vitest'),
      ],
    };
    const errs = validatePlan(plan, 'frontend');
    expect(errs.some((e) => e.includes('privacidad'))).toBe(true);
    expect(errs.some((e) => e.includes('404'))).toBe(true);
    // con el bloque inyectado pasa (dedup con la regla de stack por error idéntico)
    applyCompliance(plan, plan.compliance);
    plan.compliance.forEach((id) => {
      expect(
        complianceRequirements([id]).every((r) => {
          const t = (plan.steps[1].description + ' ' + plan.steps[1].verify).toLowerCase();
          return r.keywords.every((k) => t.includes(k));
        }),
      ).toBe(true);
    });
    // los bullets para prompts vienen de la misma fuente
    expect(complianceRuleBullets(['notfound'])[0]).toContain('404');
  });
});
