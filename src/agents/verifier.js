import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { awaitInstall, isInstalling } from '../tools/install.js';
import { activity, log, writePlan } from './common.js';

/**
 * Corre step.verify dentro del proyecto generado.
 * Éxito: marca el paso 'done' y avanza. Fallo: lastError = stderr.
 */
export async function verifierNode(state) {
  const step = state.plan.steps[state.currentStepIndex];

  // npm install corre en background desde preflight — si todavía
  // está corriendo lo esperamos acá, antes de tocar node_modules.
  if (isInstalling(state.projectDir)) activity('esperando npm install…');
  const install = await awaitInstall(state.projectDir);
  if (!install.ok) {
    const err = `npm install del proyecto falló: ${install.stderr.slice(-500)}`;
    return {
      lastError: err,
      history: [log('verify', `paso ${step.id}: FAIL — ${err.slice(0, 200)}`)],
    };
  }

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
