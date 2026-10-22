import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { log, writePlan } from './common.js';

/**
 * Corre step.verify dentro del proyecto generado.
 * Éxito: marca el paso 'done' y avanza. Fallo: lastError = stderr.
 */
export async function verifierNode(state) {
  const step = state.plan.steps[state.currentStepIndex];
  const res = await run(step.verify, {
    cwd: state.projectDir,
    timeoutMs: config.verifyTimeoutMs,
  });

  if (!res.ok) {
    const err = `verify falló (exit ${res.exitCode ?? 'timeout'}): ${res.stderr || res.stdout}`.slice(0, 4000);
    return {
      lastError: err,
      lastOutput: (res.stdout + '\n' + res.stderr).slice(-4000),
      history: [log('verify', `paso ${step.id}: FAIL — ${err.slice(0, 200)}`)],
    };
  }

  const plan = structuredClone(state.plan);
  plan.steps[state.currentStepIndex].status = 'done';
  writePlan(state.projectDir, plan);

  return {
    plan,
    currentStepIndex: state.currentStepIndex + 1,
    stepRetries: 0,
    lastError: null,
    lastOutput: res.stdout.slice(-2000),
    history: [log('verify', `paso ${step.id}: OK (${step.verify})`)],
  };
}
