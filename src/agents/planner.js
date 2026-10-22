import { log, writePlan } from './common.js';

/**
 * STUB (T4 lo implementa con Devin): genera un plan de 2 pasos que ejercita
 * el bucle build→verify del grafo. El paso 2 verifica un artefacto real.
 */
export async function plannerNode(state) {
  const plan = {
    projectName: state.projectSlug,
    scope: state.scope,
    appType: 'custom',
    validated: false,
    steps: [
      {
        id: 1,
        description: '[stub] crear archivo de prueba',
        type: 'infra',
        verify: process.env.MB_STUB_VERIFY ?? 'echo "stub" > step1.txt && test -f step1.txt',
        status: 'pending',
        attempts: 0,
      },
      {
        id: 2,
        description: '[stub] verificar que plan.json existe',
        type: 'test',
        verify: 'test -f plan.json',
        status: 'pending',
        attempts: 0,
      },
    ],
  };
  writePlan(state.projectDir, plan);
  return {
    plan,
    status: 'planned',
    history: [log('plan', `plan stub con ${plan.steps.length} pasos`)],
  };
}

/**
 * STUB (T4): repararía el plan vía Devin usando validationErrors.
 */
export async function repairPlanNode(state) {
  return {
    planRetries: state.planRetries + 1,
    history: [log('repairPlan', 'reparación de plan (stub)')],
  };
}
