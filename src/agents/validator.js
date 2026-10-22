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
 */
export function validatePlan(plan, scope) {
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

  // Requisitos por scope
  if (hasFrontend(scope)) {
    if (!steps.some((s) => mentions(s, 'vite')))
      errors.push('falta paso de init Vite+React+Tailwind');
    if (!steps.some((s) => s.type === 'e2e' && mentions(s, 'playwright')))
      errors.push('falta paso e2e con Playwright');
    if (steps.some((s) => s.type === 'frontend' && !mentions(s, 'ui')))
      errors.push('los pasos frontend deben mencionar las reglas de UI');
  }
  if (hasBackend(scope)) {
    if (!steps.some((s) => mentions(s, 'express')))
      errors.push('falta paso de Express');
    if (!steps.some((s) => mentions(s, 'sqlite')))
      errors.push('falta paso de SQLite');
  }
  if (!steps.some((s) => s.type === 'test' && mentions(s, 'vitest')))
    errors.push('falta paso test con Vitest');

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
