import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { runAgentPrompt } from '../tools/acp.js';
import { awaitInstall, isInstalling } from '../tools/install.js';
import { activity, log, loadPrompt, runLogPath, textFeed, writePlan } from './common.js';

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

  // npm install corre en background desde preflight — esperarlo
  // antes de abrir la sesión Devin (el agente puede correr npm).
  if (isInstalling(state.projectDir)) activity('esperando npm install…');
  const install = await awaitInstall(state.projectDir);
  if (!install.ok) {
    return {
      plan,
      status: 'failed',
      lastError: `npm install falló: ${install.stderr.slice(-500)}`,
      history: [log('build', `paso ${step.id}: npm install falló — no se consume Devin`)],
    };
  }

  const prompt = loadPrompt('builder', {
    step_id: step.id,
    total,
    type: step.type,
    description: step.description,
    idea: state.idea,
    scope: state.scope,
    appType: state.appType,
  });

  const feed = textFeed();
  const res = await runAgentPrompt({
    agent: state.agent,
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, `build-${step.id}`),
    onActivity: activity,
    onText: feed.onText,
  });
  feed.flush();

  if (!res.ok) {
    return {
      plan,
      status: 'failed',
      lastError: `builder paso ${step.id}: ${res.error}`,
      history: [log('build', `paso ${step.id}: ${res.engine ?? 'agente'} falló — ${res.error}`)],
    };
  }

  return {
    plan,
    status: 'building',
    history: [log('build', `paso ${step.id}: implementado por ${res.engine ?? 'agente'} (stop=${res.stopReason})`)],
  };
}
