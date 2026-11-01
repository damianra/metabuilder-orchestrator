import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getStack, listStacks, resolveStacks } from '../src/stacks/index.js';
import { detectStackId } from '../src/tools/docker.js';
import { validatePlan } from '../src/agents/validator.js';

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'mb-expo-')));

const stack = getStack('expo-mobile');

describe('stack expo-mobile — registro y contrato', () => {
  it('registrado como kind mobile, fuera del listado frontend', () => {
    expect(stack).not.toBeNull();
    expect(stack.kind).toBe('mobile');
    expect(listStacks('mobile').map((s) => s.id)).toContain('expo-mobile');
    expect(listStacks('frontend').map((s) => s.id)).not.toContain('expo-mobile');
  });

  it('resolveStacks lo acepta como stackFrontend por id', () => {
    const { frontend } = resolveStacks('frontend', { frontend: 'expo-mobile' });
    expect(frontend.id).toBe('expo-mobile');
  });

  it('detect: app.json + dep expo → expo-mobile; sin una de las dos → null', () => {
    const d = tmp();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { expo: '~54.0.0' } }));
    writeFileSync(join(d, 'app.json'), JSON.stringify({ expo: { slug: 'x' } }));
    expect(detectStackId(d)).toBe('expo-mobile');

    // app.json sin dep expo (p.ej. config suelta) → no matchea
    const d2 = tmp();
    writeFileSync(join(d2, 'package.json'), JSON.stringify({ dependencies: {} }));
    writeFileSync(join(d2, 'app.json'), JSON.stringify({ expo: { slug: 'x' } }));
    expect(detectStackId(d2)).toBeNull();

    // dep expo sin app.json → no matchea
    const d3 = tmp();
    writeFileSync(join(d3, 'package.json'), JSON.stringify({ dependencies: { expo: '~54.0.0' } }));
    expect(detectStackId(d3)).toBeNull();
  });

  it('detectPriority menor que vite-react (gana ante ambigüedad)', () => {
    expect(stack.detectPriority).toBeLessThan(getStack('vite-react').detectPriority);
  });

  it('toolchain: devCmd spliteable por split(/\\s+/) sin env-prefix', () => {
    // El spawn del dashboard/smoke no usa shell: el primer token debe
    // ser un ejecutable real ('npm'), nunca 'VAR=1'.
    const [bin] = stack.toolchain.devCmd.split(/\s+/);
    expect(bin).toBe('npm');
    expect(stack.toolchain.devPort).toBe(8081);
    expect(stack.toolchain.installCmd).toBe('npm install');
    // buildCmd es smoke de bundle web — NUNCA un build nativo (Java/SDK).
    expect(stack.toolchain.buildCmd).not.toMatch(/gradle|apk|eas/);
  });

  it('requirements respetan el shape del validator y keywords AND-seguras', () => {
    for (const r of stack.requirements) {
      expect(['some', 'each']).toContain(r.check);
      expect([null, 'frontend', 'backend', 'test', 'e2e', 'infra']).toContain(r.type);
      expect(Array.isArray(r.keywords)).toBe(true);
      // Keywords AND (mentions() exige todas) → substrings únicos.
      expect(r.keywords).toHaveLength(1);
      expect(typeof r.error).toBe('string');
      expect(typeof r.prompt).toBe('string');
    }
  });

  it('readme es objeto con el shape que consume finalizer', () => {
    for (const k of ['stack', 'e2eSuffix', 'dev']) {
      expect(typeof stack.readme[k]).toBe('string');
    }
    expect(Array.isArray(stack.readme.tests)).toBe(true);
  });
});

describe('stack expo-mobile — validatePlan', () => {
  const step = (over) => ({
    id: 1, type: 'frontend', description: '', verify: '', status: 'pending', attempts: 0, ...over,
  });
  const plan = (steps) => ({
    projectName: 'x', scope: 'frontend', appType: 'custom', validated: false, steps,
    stacks: { frontend: 'expo-mobile', backend: null },
  });
  const mobileSteps = [
    step({ id: 1, description: 'Init Expo con Expo Router + NativeWind', verify: 'npm run web' }),
    step({ id: 2, description: 'Pantallas con animaciones Moti y fallback web', verify: 'npm run web' }),
    step({ id: 3, type: 'test', description: 'typecheck tsc', verify: 'npx tsc --noEmit' }),
    step({ id: 4, type: 'e2e', description: 'specs Playwright preview web', verify: 'npm run test:e2e' }),
  ];

  it('un plan con los 4 pasos requeridos valida', () => {
    const stacks = resolveStacks('frontend', { frontend: 'expo-mobile' });
    expect(validatePlan(plan(mobileSteps), 'frontend', { stacks })).toEqual([]);
  });

  it('sin paso de animaciones → error del requirement', () => {
    const steps = mobileSteps.filter((s) => s.id !== 2);
    const stacks = resolveStacks('frontend', { frontend: 'expo-mobile' });
    expect(validatePlan(plan(steps), 'frontend', { stacks })).toContain(
      'falta paso frontend con animaciones',
    );
  });

  it('mobile no hereda requirements de compliance web', () => {
    // Una idea que inferiría compliance web (formularios/contacto) no
    // debe agregar requirements imposibles a un plan mobile.
    const stacks = resolveStacks('frontend', { frontend: 'expo-mobile' });
    const res = validatePlan(
      { ...plan(mobileSteps), idea: 'app con formulario de contacto y datos personales' },
      'frontend',
      { stacks },
    );
    expect(res).toEqual([]);
  });
});
