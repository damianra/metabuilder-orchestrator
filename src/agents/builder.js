import { log } from './common.js';

/**
 * STUB (T5 lo implementa con runDevinPrompt): no escribe código real.
 */
export async function builderNode(state) {
  const step = state.plan?.steps?.[state.currentStepIndex];
  return {
    status: 'building',
    history: [
      log('build', `paso ${state.currentStepIndex + 1}/${state.plan.steps.length}: ${step?.description ?? '?'} (stub)`),
    ],
  };
}
