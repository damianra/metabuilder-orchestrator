import { log } from './common.js';

/**
 * STUB (T4 implementa validación real por scope): aprueba todo.
 */
export async function validatorNode(state) {
  return {
    validationErrors: [],
    status: 'validated',
    history: [log('validate', 'validación stub: OK')],
  };
}
