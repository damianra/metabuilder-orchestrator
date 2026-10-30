import { config } from '../config.js';
import { readSettings } from '../tools/settings.js';
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
 * Id del engine elegido, SIN sonda de auth. Precedencia:
 *   flag (--agent / state.agent) > settings.json `engine` (dashboard,
 *   si no es 'auto') > env AGENT_PROVIDER > plan.agent (resume) > 'auto'.
 * El engine ACTIVO siempre gana sobre el guardado en plan.json — un
 * resume con el engine muerto (sin tokens) se desbloquea cambiando
 * el config, sin tocar el plan. `plan.agent` queda como fallback
 * histórico cuando nada está configurado.
 * `sources.flag` puede ser '' (default del state) — se ignora.
 * 'auto' lo resuelve con probe el caller que pueda (preflight);
 * resolveEngine() lo mapea a 'devin' para callers síncronos.
 */
export function resolveEngineId({ flag, plan, settings } = {}) {
  const configured = settings !== undefined ? settings : readSettings().engine;
  return (
    flag ||
    (configured && configured !== 'auto' ? configured : null) ||
    config.agentProvider ||
    plan ||
    'auto'
  );
}

/**
 * Resuelve a un engine concreto. Acepta un id string, un objeto de
 * sources ({flag, plan, settings}) o nada. 'auto'/'' sin probe →
 * 'devin' (default histórico; el auto real con fallback a opencode
 * vive en preflight via resolveEngineAuto).
 */
export function resolveEngine(sources) {
  let id = typeof sources === 'string' ? sources : resolveEngineId(sources);
  if (!id || id === 'auto') id = 'devin';
  const engine = ENGINES.get(id);
  if (!engine) {
    throw new Error(`engine desconocido "${id}" (usá ${listEngines().join('|')}|auto)`);
  }
  return engine;
}

/**
 * Resolución 'auto' con sonda real: el primer engine del registry que
 * autentica gana (devin primero por default histórico). `probe` es
 * inyectable (preflight pasa checkEngineAuth). null si ninguno anda —
 * el caller convierte eso en fail con mensaje accionable.
 */
export async function resolveEngineAuto(probe) {
  for (const id of listEngines()) {
    if ((await probe(id)).ok) return getEngine(id);
  }
  return null;
}
