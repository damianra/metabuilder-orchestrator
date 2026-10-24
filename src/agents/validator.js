import { planRequirements, resolveStacks } from '../stacks/index.js';
import { log, writePlan } from './common.js';

const STEP_TYPES = new Set(['frontend', 'backend', 'test', 'e2e', 'infra']);
const hasFrontend = (scope) => scope !== 'backend';
const hasBackend = (scope) => scope !== 'frontend';

const mentions = (step, ...words) => {
  const d = (step.description + ' ' + step.verify).toLowerCase();
  return words.every((w) => d.includes(w));
};

/**
 * Validación 100% local del plan.json — no consume Devin.
 * Las reglas de stack (keywords de init/e2e/test/UI) vienen del
 * registry en src/stacks/ — `stacks` inyectable para tests.
 */
export function validatePlan(plan, scope, stacks = resolveStacks(scope)) {
  const errors = [];

  if (!plan || typeof plan !== 'object') return ['plan.json ausente o inválido'];
  if (!plan.projectName || typeof plan.projectName !== 'string')
    errors.push('falta projectName');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0)
    errors.push('steps vacío o ausente');

  if (errors.length) return errors;

  const steps = plan.steps;
  steps.forEach((s, i) => {
    if (typeof s.id !== 'number') errors.push(`step[${i}]: falta id numérico`);
    if (!s.description) errors.push(`step[${i}]: falta description`);
    if (!STEP_TYPES.has(s.type))
      errors.push(`step[${i}]: type inválido "${s.type}" (esperado: ${[...STEP_TYPES].join('|')})`);
    if (!s.verify || typeof s.verify !== 'string')
      errors.push(`step[${i}]: falta verify (comando ejecutable)`);
  });

  // Restricciones de scope
  if (!hasFrontend(scope) && steps.some((s) => s.type === 'frontend' || s.type === 'e2e'))
    errors.push('scope backend no debe incluir pasos frontend/e2e');
  if (!hasBackend(scope) && steps.some((s) => s.type === 'backend'))
    errors.push('scope frontend no debe incluir pasos backend');

  // Requisitos declarativos de los stacks activos (src/stacks/).
  for (const req of planRequirements(stacks)) {
    if (req.check === 'some') {
      const ok = steps.some(
        (s) => (req.type === null || s.type === req.type) && mentions(s, ...req.keywords),
      );
      if (!ok) errors.push(req.error);
    } else if (steps.some((s) => s.type === req.type && !mentions(s, ...req.keywords))) {
      errors.push(req.error);
    }
  }

  return errors;
}

export async function validatorNode(state) {
  const errors = validatePlan(state.plan, state.scope);

  if (errors.length === 0) {
    const plan = structuredClone(state.plan);
    plan.validated = true;
    writePlan(state.projectDir, plan);
    return {
      plan,
      validationErrors: [],
      status: 'validated',
      history: [log('validate', 'plan válido')],
    };
  }

  return {
    validationErrors: errors,
    history: [log('validate', `${errors.length} errores: ${errors.join('; ')}`)],
  };
}
