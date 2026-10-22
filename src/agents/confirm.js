import { interrupt } from '@langchain/langgraph';
import { log } from './common.js';

/**
 * Pausa el grafo para aprobación humana del plan (solo si confirmPlan=true;
 * en modo --yes o no-TTY pasa directo). interrupt() suspende la ejecución;
 * al resumir, devuelve el valor pasado vía Command({resume}).
 */
export async function confirmNode(state) {
  if (!state.confirmPlan) {
    return { history: [log('confirm', 'sin confirmación (auto)')] };
  }

  const answer = interrupt({ plan: state.plan });
  const approved = answer !== 'n' && answer !== 'no' && answer !== false;

  if (!approved) {
    return {
      status: 'failed',
      lastError: 'plan rechazado por el usuario',
      history: [log('confirm', 'plan rechazado')],
    };
  }
  return { history: [log('confirm', 'plan aprobado')] };
}
