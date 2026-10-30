import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plannerNode } from '../src/agents/planner.js';
import { validatePlan } from '../src/agents/validator.js';
import { resolveStacks } from '../src/stacks/index.js';

const fakeProject = (steps) => {
  const dir = mkdtempSync(join(tmpdir(), 'mb-fast-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/App.jsx'), "fetch('/api/x'); fetch('/api/x', {method:'POST'});");
  writeFileSync(join(dir, 'plan.json'), JSON.stringify({
    projectName: 'x', scope: 'frontend', appType: 'custom', idea: 'x',
    stacks: { frontend: 'vite-react' }, validated: true, steps,
  }));
  return dir;
};
const state = (dir, extra = {}) => ({
  projectDir: dir, projectSlug: 'x', extend: true, resumeDir: dir,
  scope: 'frontend', appType: 'custom', agent: 'devin',
  deployGithub: false, deployPages: false, history: [], ...extra,
});
const done = (id, type, extra = {}) => ({ id, type, description: 's', verify: 'npm run build', status: 'done', attempts: 1, ...extra });

describe('planner extend — plan fijo por contrato', () => {
  it('appendea backend→integración→test→e2e, valida y retoma en el paso nuevo', async () => {
    const dir = fakeProject([done(1, 'frontend')]);
    const out = await plannerNode(state(dir));
    const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
    expect(plan.steps.length).toBe(5); // 1 done + backend + frontend + test + e2e
    expect(plan.steps.slice(1).every((s) => s.status === 'pending')).toBe(true);
    expect(plan.scope).toBe('fullstack');
    expect(plan.stacks.backend).toBe('express-sqlite');
    expect(out.currentStepIndex).toBe(1); // retoma en el primer paso nuevo
    expect(validatePlan(plan, plan.scope, { stacks: resolveStacks(plan.scope, plan.stacks) })).toEqual([]);
  });
  it('dedup e2e si el plan ya lo tiene + fastapi agrega paso pytest', async () => {
    const dir = fakeProject([done(1, 'frontend'), done(2, 'e2e', { verify: 'npm run test:e2e', description: 'Spec Playwright del flujo' })]);
    const out = await plannerNode(state(dir, { stackBackend: 'fastapi' }));
    const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
    expect(plan.steps.filter((s) => s.type === 'e2e').length).toBe(1);
    expect(plan.steps.filter((s) => s.type === 'test').length).toBe(2); // vitest + pytest
    expect(validatePlan(plan, plan.scope, { stacks: resolveStacks(plan.scope, plan.stacks) })).toEqual([]);
    expect(out.currentStepIndex).toBe(2);
  });
});
