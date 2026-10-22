import { log } from './common.js';

/**
 * STUB (T6 implementa la batería final: build + vitest + playwright).
 * Por ahora solo marca el modo de verificación y limpia el error.
 */
export async function finalVerifyNode(state) {
  return {
    verifying: 'final',
    lastError: null,
    status: 'finalVerifying',
    history: [log('finalVerify', 'verificación final (stub: pasa)')],
  };
}

/**
 * STUB (T6 implementa git init/config/commit/push).
 */
export async function finalizerNode(state) {
  return {
    status: 'done',
    history: [log('finalize', 'finalización (stub: sin git ni push)')],
  };
}
