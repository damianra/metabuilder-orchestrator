import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveResumeDir } from '../src/tools/slug.js';
import { plannerNode } from '../src/agents/planner.js';

const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

const writePlanJson = (dir, plan) =>
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2));

const samplePlan = (statuses) => ({
  projectName: 'demo',
  scope: 'backend',
  appType: 'orders',
  idea: 'tienda de prueba',
  validated: true,
  steps: statuses.map((status, i) => ({
    id: i + 1,
    description: `paso ${i + 1}`,
    type: 'backend',
    verify: 'true',
    status,
    attempts: 0,
  })),
});

describe('resolveResumeDir', () => {
  it('resuelve una ruta directa con plan.json', () => {
    const dir = tmp('resume-');
    writePlanJson(dir, samplePlan(['pending']));
    expect(resolveResumeDir(dir, '/no/existe')).toBe(dir);
  });

  it('resuelve un slug dentro de generatedAppsDir', () => {
    const base = tmp('genapps-');
    const dir = join(base, 'mi-app');
    mkdirSync(dir);
    writePlanJson(dir, samplePlan(['pending']));
    expect(resolveResumeDir('mi-app', base)).toBe(dir);
  });

  it('null si no existe o no tiene plan.json', () => {
    const dir = tmp('resume-vacio-');
    expect(resolveResumeDir(dir, '/no/existe')).toBeNull();
    expect(resolveResumeDir('no-existe', tmp('genapps-'))).toBeNull();
  });
});

describe('plannerNode — camino resume (plan.json existente)', () => {
  const state = (projectDir, extra = {}) => ({
    projectDir,
    projectSlug: 'demo',
    idea: '',
    scope: 'fullstack',
    appType: 'custom',
    ...extra,
  });

  it('normaliza pasos no-done a pending y retoma en el primero', async () => {
    const dir = tmp('plan-');
    writePlanJson(dir, samplePlan(['done', 'building', 'pending', 'done']));
    const out = await plannerNode(state(dir));
    expect(out.currentStepIndex).toBe(1);
    expect(out.plan.steps.map((s) => s.status)).toEqual([
      'done',
      'pending',
      'pending',
      'done',
    ]);
    // el plan normalizado quedó persistido
    const onDisk = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
    expect(onDisk.steps[1].status).toBe('pending');
  });

  it('sella plan.agent con el engine efectivo del run (state.agent)', async () => {
    const dir = tmp('plan-');
    writePlanJson(dir, samplePlan(['done']));
    const out = await plannerNode(state(dir, { agent: 'opencode' }));
    const onDisk = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
    expect(onDisk.agent).toBe('opencode');
    expect(out.plan.agent).toBe('opencode');
  });

  it('restaura scope/appType/idea del plan (no del CLI)', async () => {
    const dir = tmp('plan-');
    writePlanJson(dir, samplePlan(['done', 'pending']));
    const out = await plannerNode(state(dir));
    expect(out.scope).toBe('backend');
    expect(out.appType).toBe('orders');
    expect(out.idea).toBe('tienda de prueba');
  });

  it('--idea explícita tiene prioridad sobre la del plan', async () => {
    const dir = tmp('plan-');
    writePlanJson(dir, samplePlan(['pending']));
    const out = await plannerNode(state(dir, { idea: 'idea nueva' }));
    expect(out.idea).toBe('idea nueva');
  });

  it('todo done → currentStepIndex = length (salta a finalVerify)', async () => {
    const dir = tmp('plan-');
    writePlanJson(dir, samplePlan(['done', 'done']));
    const out = await plannerNode(state(dir));
    expect(out.currentStepIndex).toBe(2);
    expect(out.history[0].msg).toContain('verificación final');
  });
});
