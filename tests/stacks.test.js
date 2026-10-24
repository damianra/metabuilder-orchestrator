import { describe, expect, it } from 'vitest';
import {
  finalCheckCommands,
  getStack,
  listStacks,
  planRequirements,
  resolveStacks,
  stackRuleBullets,
} from '../src/stacks/index.js';
import { validatePlan } from '../src/agents/validator.js';

const step = (over) => ({
  id: 1,
  description: '',
  type: 'frontend',
  verify: 'npm run build',
  status: 'pending',
  attempts: 0,
  ...over,
});

const fullPlan = (steps) => ({
  projectName: 'x',
  scope: 'fullstack',
  appType: 'custom',
  validated: false,
  steps,
});

const OK_STEPS = [
  step({ id: 1, type: 'infra', description: 'init Vite+React+Tailwind', verify: 'npm run build' }),
  step({ id: 2, type: 'backend', description: 'Express + SQLite API', verify: 'npm run api' }),
  step({ id: 3, type: 'frontend', description: 'pantallas con reglas de UI', verify: 'npm run build' }),
  step({ id: 4, type: 'test', description: 'suite Vitest', verify: 'npx vitest run' }),
  step({ id: 5, type: 'e2e', description: 'specs Playwright', verify: 'npm run test:e2e' }),
];

describe('resolveStacks', () => {
  it('fullstack resuelve ambos defaults', () => {
    const { frontend, backend } = resolveStacks('fullstack');
    expect(frontend.id).toBe('vite-react');
    expect(backend.id).toBe('express-sqlite');
  });

  it('scope frontend/backend anula el stack opuesto', () => {
    expect(resolveStacks('frontend').backend).toBeNull();
    expect(resolveStacks('backend').frontend).toBeNull();
  });

  it('overrides por id; id desconocido lanza', () => {
    expect(resolveStacks('frontend', { frontend: 'vite-react' }).frontend.id).toBe('vite-react');
    expect(() => resolveStacks('frontend', { frontend: 'svelte' })).toThrow('svelte');
  });
});

describe('listStacks/getStack', () => {
  it('filtra por kind y resuelve por id', () => {
    expect(listStacks('frontend').map((s) => s.id)).toEqual(['vite-react']);
    expect(listStacks('backend').map((s) => s.id)).toEqual(['express-sqlite']);
    expect(getStack('vite-react').kind).toBe('frontend');
    expect(getStack('nope')).toBeNull();
  });
});

describe('planRequirements', () => {
  it('mergea ambos stacks dedupando el requisito vitest compartido', () => {
    const reqs = planRequirements(resolveStacks('fullstack'));
    const vitestReqs = reqs.filter((r) => r.keywords.includes('vitest'));
    expect(vitestReqs).toHaveLength(1);
    expect(reqs.some((r) => r.keywords.includes('vite'))).toBe(true);
    expect(reqs.some((r) => r.keywords.includes('express'))).toBe(true);
  });
});

describe('finalCheckCommands', () => {
  it('fullstack: build + test + e2e (test deduplicado)', () => {
    expect(finalCheckCommands(resolveStacks('fullstack'))).toEqual([
      'npm run build',
      'npx vitest run',
      'npm run test:e2e',
    ]);
  });

  it('backend-only: solo vitest', () => {
    expect(finalCheckCommands(resolveStacks('backend'))).toEqual(['npx vitest run']);
  });
});

describe('stackRuleBullets', () => {
  it('genera las reglas del scope con bullets de cada requisito', () => {
    const bullets = stackRuleBullets('backend');
    expect(bullets).toContain('Express + SQLite');
    expect(bullets).toContain('NO incluir pasos frontend');
    expect(bullets).not.toContain('Vite + React');
    expect(stackRuleBullets('frontend')).toContain('NO incluir pasos backend');
  });
});

describe('validatePlan vía registry', () => {
  it('plan válido pasa igual que antes', () => {
    expect(validatePlan(fullPlan(OK_STEPS), 'fullstack')).toEqual([]);
  });

  it('los errores vienen de los requirements del stack', () => {
    // Sin paso backend ni e2e (nota: 'vitest' contiene el substring
    // 'vite' — comportamiento preexistente de `mentions`).
    const errs = validatePlan(
      fullPlan([OK_STEPS[0], OK_STEPS[2], OK_STEPS[3]]),
      'fullstack',
    );
    expect(errs).toContain('falta paso de Express');
    expect(errs).toContain('falta paso de SQLite');
    expect(errs).toContain('falta paso e2e con Playwright');
  });

  it('stacks inyectables: un stack custom aporta sus propias reglas', () => {
    const custom = {
      frontend: null,
      backend: {
        requirements: [
          { check: 'some', type: null, keywords: ['fastify'], error: 'falta paso de Fastify' },
        ],
      },
    };
    const errs = validatePlan(fullPlan(OK_STEPS), 'backend', custom);
    // El stack custom aporta su propia regla (además del error de
    // scope por los pasos frontend/e2e del plan de prueba).
    expect(errs).toContain('falta paso de Fastify');
  });
});
