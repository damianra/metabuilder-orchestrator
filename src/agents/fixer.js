import { config } from '../config.js';
import { runDevinPrompt } from '../tools/devin.js';
import { log, loadPrompt, runLogPath, writePlan } from './common.js';

/**
 * Envía el fallo de verificación a Devin para reparar la causa raíz.
 * Consume un intento (stepRetries/finalRetries y plan.steps[i].attempts).
 * Si la llamada de transporte falla, el intento igual se consume y
 * verify re-corre (que reportará el error original).
 */
export async function fixerNode(state) {
  const isFinal = state.verifying === 'final';
  const plan = structuredClone(state.plan);
  const step = plan?.steps?.[state.currentStepIndex];

  if (!isFinal && step) {
    step.attempts += 1;
    step.status = 'fixing';
    writePlan(state.projectDir, plan);
  }
  const attempt = (isFinal ? state.finalRetries : state.stepRetries) + 1;

  const prompt = loadPrompt('fixer', {
    step_id: isFinal ? 'final' : (step?.id ?? '?'),
    type: isFinal ? 'final' : (step?.type ?? '?'),
    description: isFinal
      ? 'Verificación final del proyecto completo (build + tests).'
      : (step?.description ?? ''),
    verify: isFinal ? 'npm run build && npx vitest run (+ npm run test:e2e si existe)' : (step?.verify ?? ''),
    error: (state.lastOutput || state.lastError || 'sin salida').slice(-3500),
  });

  const res = await runDevinPrompt({
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, `fix-${isFinal ? 'final' : step?.id}-${attempt}`),
  });

  return {
    plan,
    stepRetries: isFinal ? state.stepRetries : state.stepRetries + 1,
    finalRetries: isFinal ? state.finalRetries + 1 : state.finalRetries,
    status: 'fixing',
    history: [
      log(
        'fix',
        res.ok
          ? `reparación aplicada por Devin (intento ${attempt}/${config.maxStepRetries})`
          : `Devin no respondió (intento ${attempt}/${config.maxStepRetries}): ${res.error}`,
      ),
    ],
  };
}
