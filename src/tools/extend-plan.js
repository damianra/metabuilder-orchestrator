// Normalización determinística del plan tras la sesión del extender:
// el agente appendea pasos a plan.json, pero los metadatos (scope,
// stacks, validated, ids, keywords de pasos done legacy) no se le
// confían — igual que repairPlan re-aplica applyArch/applyCompliance.
import { detectStackId } from './docker.js';

// Sufijo canónico para pasos frontend sin keywords de stack — los
// requirements 'each'/'some' del stack vite-react exigen "ui" en cada
// paso frontend y "vite" en alguno. Es honesto: todo paso frontend de
// este repo corre sobre ese skeleton y debe seguir las reglas de UI.
const UI_TAG = ' — UI implementada sobre Vite + React + Tailwind aplicando las reglas de UI del AGENTS.md';

/**
 * Deja el plan listo para validate tras la extensión:
 * - scope pasa a 'fullstack' (habilita pasos backend).
 * - validated=false → el plan fusionado se re-valida completo.
 * - stacks.backend/frontend rellenados (plan sintético de saveDesign
 *   no declara stacks; planes frontend dejan backend:null).
 * - pasos frontend sin keywords → sufijo canónico (cubre 'each' ui y
 *   'some' vite; incluye el step done legacy de saveDesign).
 * - ids renumerados, attempts/status saneados (defensa ante salida
 *   de agente ruidosa).
 * Devuelve cuántos pasos nuevos (pending) se agregaron respecto de
 * `doneCount` — el caller lo usa para el log.
 */
export function normalizeExtendedPlan(
  plan,
  { dir = null, stackFrontend = 'vite-react', stackBackend = 'express-sqlite' } = {},
) {
  plan.scope = 'fullstack';
  plan.validated = false;
  plan.stacks ??= {};
  plan.stacks.backend ??= stackBackend;
  plan.stacks.frontend ??= (dir && detectStackId(dir)) || stackFrontend;

  for (const s of plan.steps ?? []) {
    if (s.type !== 'frontend') continue;
    const d = (s.description ?? '').toLowerCase();
    if (!d.includes('ui') || !d.includes('vite')) s.description = (s.description ?? '') + UI_TAG;
  }

  let id = 0;
  for (const s of plan.steps ?? []) {
    s.id = ++id;
    s.attempts ??= 0;
    s.status ??= 'pending';
  }
  return plan;
}
