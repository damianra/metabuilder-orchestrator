import { landing } from './landing/index.js';
import { orders } from './orders/index.js';

export const verticals = { landing, orders };

export function getVertical(appType) {
  return verticals[appType] ?? null;
}

export function listVerticals() {
  return Object.keys(verticals);
}

/**
 * Infiere el vertical desde la idea cuando no se pasa --appType.
 * 'custom' cae al planner LLM (Devin).
 */
export function inferAppType(idea, scope) {
  const t = (idea ?? '').toLowerCase();
  if (/(pedido|order|delivery|restaurante|comida|pizzer|burger|menu)/.test(t)) {
    return 'orders';
  }
  if (scope !== 'backend') return 'landing';
  return 'custom';
}
