import { config } from '../config.js';
import devin from './devin.js';
import opencode from './opencode.js';

// Registry de engines de agente (mismo patrón que src/stacks/ y
// src/arch/): cada engine es un descriptor de datos — bin, args ACP,
// auth, mode/model default y args del TUI para la terminal del
// dashboard. Agregar un engine = nuevo archivo + entrada en el Map.
const ENGINES = new Map([devin, opencode].map((e) => [e.id, e]));

export const listEngines = () => [...ENGINES.keys()];
export const getEngine = (id) => ENGINES.get(id) ?? null;

/**
 * Resuelve el engine efectivo. Precedencia:
 *   explícito (--agent / state.agent / plan.agent) > AGENT_PROVIDER
 *   env > 'devin'.
 * Lanza si el id no es un engine conocido — el caller decide si lo
 * convierte en fail del pipeline (preflight) o en error del CLI.
 */
export function resolveEngine(explicit) {
  const id = explicit || config.agentProvider || 'devin';
  const engine = ENGINES.get(id);
  if (!engine) {
    throw new Error(`engine desconocido "${id}" (usá ${listEngines().join('|')})`);
  }
  return engine;
}
