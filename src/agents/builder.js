import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { runDevinPrompt } from '../tools/devin.js';
import { log, loadPrompt, runLogPath, writePlan } from './common.js';

/**
 * Ejecuta el paso actual del plan via Devin ACP.
 * Los pasos 'infra' con skeleton ya copiado no consumen sesión de Devin:
 * el verify (`npm run build`) es la verificación real.
 */
export async function builderNode(state) {
  const step = state.plan.steps[state.currentStepIndex];
  const total = state.plan.steps.length;

  if (step.type === 'infra' && existsSync(join(state.projectDir, 'package.json'))) {
    return {
      status: 'building',
      history: [
        log('build', `paso ${step.id}/${total} (infra): skeleton ya presente — pasa a verify`),
      ],
    };
  }

  const plan = structuredClone(state.plan);
  plan.steps[state.currentStepIndex].status = 'building';
  writePlan(state.projectDir, plan);

  const prompt = loadPrompt('builder', {
    step_id: step.id,
    total,
    type: step.type,
    description: step.description,
    idea: state.idea,
    scope: state.scope,
    appType: state.appType,
  });

  const res = await runDevinPrompt({
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, `build-${step.id}`),
  });

  if (!res.ok) {
    return {
      plan,
      status: 'failed',
      lastError: `builder paso ${step.id}: ${res.error}`,
      history: [log('build', `paso ${step.id}: Devin falló — ${res.error}`)],
    };
  }

  return {
    plan,
    status: 'building',
    history: [log('build', `paso ${step.id}: implementado por Devin (stop=${res.stopReason})`)],
  };
}
