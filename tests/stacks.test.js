import { describe, expect, it } from 'vitest';
import {
  backendMatrix,
  finalCheckCommands,
  getStack,
  listStacks,
  planRequirements,
  resolveBackendStackId,
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
  step({ id: 3, type: 'frontend', description: 'pantallas con reglas de UI + privacidad y consentimiento + página 404', verify: 'npm run build' }),
  step({ id: 4, type: 'test', description: 'suite Vitest', verify: 'npx vitest run' }),
  step({ id: 5, type: 'e2e', description: 'specs Playwright', verify: 'npm run test:e2e' }),
];

describe('resolveStacks', () => {
  it('fullstack resuelve ambos defaults', () => {
    const { frontend, backend } = resolveStacks('fullstack');
    expect(frontend.id).toBe('vite-react');
    expect(backend.id).toBe('express-sqlite');
  });

  it('stacks backend extra resuelven kind + skeleton + keywords propias', () => {
    const expected = [
      ['express-postgres', 'api-skeleton-sql', 'postgres'],
      ['express-mysql', 'api-skeleton-sql', 'mysql'],
      ['express-mongo', 'api-skeleton-mongo', 'mongodb'],
      ['nest-typeorm', 'nest-skeleton', 'nestjs'],
    ];
    for (const [id, skel, kwStack] of expected) {
      const s = getStack(id);
      expect(s.kind).toBe('backend');
      expect(s.skeletonDir).toBe(skel);
      expect(s.toolchain.testCmd).toBe('npx vitest run');
      const kw = planRequirements(resolveStacks('backend', { backend: id }))
        .flatMap((r) => r.keywords);
      expect(kw).toContain(kwStack);
      expect(kw).not.toContain('sqlite');
    }
    // listStacks los expone al picker del form/options
    expect(listStacks('backend').map((s) => s.id)).toEqual([
      'express-sqlite',
      'express-postgres',
      'express-mysql',
      'express-mongo',
      'nest-typeorm',
      'fastapi',
    ]);
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

describe('resolveBackendStackId + backendMatrix (v12 #3)', () => {
  it('resuelve (framework, db) → stackId; combo inválido → null', () => {
    expect(resolveBackendStackId('express', 'sqlite')).toBe('express-sqlite');
    expect(resolveBackendStackId('express', 'mongo')).toBe('express-mongo');
    expect(resolveBackendStackId('nest', 'mysql')).toBe('nest-typeorm');
    expect(resolveBackendStackId('fastapi', 'postgres')).toBe('fastapi');
    expect(resolveBackendStackId('fastapi', 'mongo')).toBeNull(); // fase 2
    expect(resolveBackendStackId('django', 'sqlite')).toBeNull();
  });

  it('la matriz filtra dbs por framework con labels y stackId', () => {
    const m = backendMatrix();
    expect(m.express.dbs.map((d) => d.id)).toEqual(['sqlite', 'postgres', 'mysql', 'mongo']);
    expect(m.nest.dbs.map((d) => d.id)).toEqual(['postgres', 'mysql', 'mongo']);
    expect(m.fastapi.dbs.map((d) => d.id)).toEqual(['sqlite', 'postgres', 'mysql']);
    expect(m.fastapi.dbs[0].stackId).toBe('fastapi');
  });
});

describe('listStacks/getStack', () => {
  it('filtra por kind y resuelve por id', () => {
    expect(listStacks('frontend').map((s) => s.id)).toEqual(['vite-react', 'nextjs']);
    expect(listStacks('backend').map((s) => s.id)).toEqual([
      'express-sqlite',
      'express-postgres',
      'express-mysql',
      'express-mongo',
      'nest-typeorm',
      'fastapi',
    ]);
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

  it('backend fastapi: solo pytest (toolchain python)', () => {
    expect(finalCheckCommands(resolveStacks('backend', { backend: 'fastapi' }))).toEqual([
      'python -m pytest',
    ]);
  });

  it('fullstack fastapi: toolchain npm del front + pytest del back', () => {
    expect(finalCheckCommands(resolveStacks('fullstack', { backend: 'fastapi' }))).toEqual([
      'npm run build',
      'npx vitest run',
      'npm run test:e2e',
      'python -m pytest',
    ]);
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
    const errs = validatePlan(fullPlan(OK_STEPS), 'backend', { stacks: custom });
    // El stack custom aporta su propia regla (además del error de
    // scope por los pasos frontend/e2e del plan de prueba).
    expect(errs).toContain('falta paso de Fastify');
  });
});

describe('stack nextjs', () => {
  it('registrado y seleccionable como override', () => {
    expect(listStacks('frontend').map((s) => s.id)).toContain('nextjs');
    const { frontend } = resolveStacks('frontend', { frontend: 'nextjs' });
    expect(frontend.id).toBe('nextjs');
    expect(frontend.buildDir).toBe('out');
    expect(frontend.skeletonDir).toContain('app-skeleton-next');
  });

  it('sus requirements validan un plan que menciona next en init', () => {
    const plan = fullPlan([
      step({ id: 1, type: 'infra', description: 'init skeleton Next.js App Router', verify: 'npm run build' }),
      step({ id: 2, type: 'backend', description: 'Express + SQLite API', verify: 'npm run api' }),
      step({ id: 3, type: 'frontend', description: 'páginas con reglas de UI + privacidad y consentimiento + página 404', verify: 'npm run build' }),
      step({ id: 4, type: 'test', description: 'suite Vitest', verify: 'npx vitest run' }),
      step({ id: 5, type: 'e2e', description: 'specs Playwright', verify: 'npm run test:e2e' }),
    ]);
    expect(
      validatePlan(plan, 'fullstack', {
        stacks: resolveStacks('fullstack', { frontend: 'nextjs' }),
      }),
    ).toEqual([]);
  });

  it('un plan vite falla contra los requirements de nextjs (reglas del stack elegido)', () => {
    // Dirección simétrica: 'vite' no contiene 'next' (al revés 'vitest'
    // sí contiene 'vite' — comportamiento preexistente de `mentions`).
    const plan = fullPlan([
      step({ id: 1, type: 'infra', description: 'init skeleton Vite + React', verify: 'npm run build' }),
      step({ id: 2, type: 'backend', description: 'Express + SQLite API', verify: 'npm run api' }),
      step({ id: 3, type: 'frontend', description: 'pantallas con reglas de UI + privacidad y consentimiento + página 404', verify: 'npm run build' }),
      step({ id: 4, type: 'test', description: 'suite Vitest', verify: 'npx vitest run' }),
      step({ id: 5, type: 'e2e', description: 'specs Playwright', verify: 'npm run test:e2e' }),
    ]);
    const errs = validatePlan(plan, 'fullstack', {
      stacks: resolveStacks('fullstack', { frontend: 'nextjs' }),
    });
    expect(errs).toContain('falta paso de init Next.js+Tailwind');
  });
});
