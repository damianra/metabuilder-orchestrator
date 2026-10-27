import { config } from '../config.js';
import { finalCheckCommands, stacksFor } from '../stacks/index.js';
import { runAgentPrompt } from '../tools/acp.js';
import { activity, log, loadPrompt, runLogPath, textFeed, writePlan } from './common.js';

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
    verify: isFinal
      ? finalCheckCommands(stacksFor(state)).join(' && ')
      : (step?.verify ?? ''),
    error: (state.lastOutput || state.lastError || 'sin salida').slice(-3500),
  });

  const feed = textFeed();
  const res = await runAgentPrompt({
    agent: state.agent,
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, `fix-${isFinal ? 'final' : step?.id}-${attempt}`),
    onActivity: activity,
    onText: feed.onText,
  });
  feed.flush();

  return {
    plan,
    stepRetries: isFinal ? state.stepRetries : state.stepRetries + 1,
    finalRetries: isFinal ? state.finalRetries + 1 : state.finalRetries,
    status: 'fixing',
    history: [
      log(
        'fix',
        res.ok
          ? `reparación aplicada por ${res.engine} (intento ${attempt}/${config.maxStepRetries})`
          : `${res.engine ?? 'agente'} no respondió (intento ${attempt}/${config.maxStepRetries}): ${res.error}`,
      ),
    ],
  };
}
