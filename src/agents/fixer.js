import { log, writePlan } from './common.js';

/**
 * STUB (T5 lo implementa con Devin): solo incrementa el contador.
 */
export async function fixerNode(state) {
  const isFinal = state.verifying === 'final';
  const plan = structuredClone(state.plan);
  if (!isFinal && plan) {
    plan.steps[state.currentStepIndex].attempts += 1;
    plan.steps[state.currentStepIndex].status = 'fixing';
    writePlan(state.projectDir, plan);
  }
  return {
    plan,
    stepRetries: isFinal ? state.stepRetries : state.stepRetries + 1,
    finalRetries: isFinal ? state.finalRetries + 1 : state.finalRetries,
    status: 'fixing',
    history: [log('fix', `intento de reparación ${isFinal ? 'final' : 'de paso'} (stub)`)],
  };
}
