import { describe, expect, it } from 'vitest';
import {
  applyArch,
  archRuleBullet,
  DEFAULT_ARCH,
  getArch,
  listArchs,
  resolveArch,
} from '../src/arch/index.js';
import { validatePlan } from '../src/agents/validator.js';
import { buildPlan as ordersPlan } from '../src/verticals/orders/index.js';

// Factory (no constante): applyArch muta la descripción — compartir el
// objeto entre tests contaminaría los casos siguientes.
const backendStep = () => ({
  id: 1,
  description: 'API Express + SQLite en server/',
  type: 'backend',
  verify: 'npx vitest run',
  status: 'pending',
  attempts: 0,
});

describe('resolveArch', () => {
  it('default es flat; cada id resuelve su def', () => {
    expect(resolveArch().id).toBe(DEFAULT_ARCH);
    for (const id of listArchs()) expect(resolveArch(id).id).toBe(id);
  });

  it('id desconocido lanza con las válidas', () => {
    expect(() => resolveArch('hexagonal')).toThrow('hexagonal');
    expect(getArch('hexagonal')).toBeNull();
    expect(listArchs()).toEqual(['flat', 'mvc', 'layers', 'feature']);
  });
});

describe('applyArch', () => {
  it('appenda instrucciones solo a pasos backend y persiste plan.arch', () => {
    const plan = {
      steps: [
        backendStep(),
        { ...backendStep(), id: 2, type: 'frontend', description: 'UI' },
      ],
    };
    applyArch(plan, resolveArch('mvc'));
    expect(plan.arch).toBe('mvc');
    expect(plan.steps[0].description).toContain('Arquitectura MVC');
    expect(plan.steps[1].description).not.toContain('Arquitectura');
  });

  it('respeta descripciones que ya declaran la arquitectura', () => {
    const plan = {
      steps: [{ ...backendStep(), description: 'API con arquitectura mvc propia' }],
    };
    applyArch(plan, resolveArch('mvc'));
    expect(plan.steps[0].description).not.toContain('Arquitectura MVC:');
  });
});

describe('validatePlan — check de arquitectura', () => {
  const plan = (steps, arch) => ({
    projectName: 'x',
    scope: 'backend',
    appType: 'custom',
    validated: false,
    arch,
    steps,
  });

  it('plan.arch declarado exige keyword en pasos backend', () => {
    const p = plan([backendStep()], 'mvc');
    expect(validatePlan(p, 'backend')).toContain(
      'los pasos backend deben declarar la arquitectura "mvc"',
    );
  });

  it('plan.arch unset → check omitido (plan viejo)', () => {
    // Solo el paso backend: sin test vitest sería otro error — se valida
    // que NO aparezca el de arquitectura.
    const errs = validatePlan(plan([backendStep()], undefined), 'backend');
    expect(errs.some((e) => e.includes('arquitectura'))).toBe(false);
  });

  it('plan post-applyArch pasa el check', () => {
    const p = plan([backendStep()], undefined);
    applyArch(p, resolveArch('layers'));
    const errs = validatePlan(p, 'backend');
    expect(errs.some((e) => e.includes('arquitectura'))).toBe(false);
  });
});

describe('integración con verticales', () => {
  it('buildPlan de orders + applyArch produce paso backend declarado', () => {
    const p = ordersPlan({ projectName: 'x', idea: 'pizzería', scope: 'backend' });
    applyArch(p, resolveArch('feature'));
    const backend = p.steps.find((s) => s.type === 'backend');
    expect(backend.description).toContain('Arquitectura FEATURE');
    expect(p.arch).toBe('feature');
  });
});

describe('archRuleBullet', () => {
  it('genera el bullet para planner.md', () => {
    const bullet = archRuleBullet(resolveArch('mvc'));
    expect(bullet).toContain('arquitectura mvc');
    expect(bullet).toContain('MVC clásico');
  });
});
