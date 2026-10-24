import flat from './flat.js';
import mvc from './mvc.js';
import layers from './layers.js';
import feature from './feature.js';

const ARCHS = new Map([flat, mvc, layers, feature].map((a) => [a.id, a]));

export const DEFAULT_ARCH = 'flat';

export function getArch(id) {
  return ARCHS.get(id) ?? null;
}

export function listArchs() {
  return [...ARCHS.keys()];
}

/**
 * Resuelve un patrón por id (default: flat). Id desconocido lanza —
 * nunca cae en silencio a otro patrón.
 */
export function resolveArch(id = DEFAULT_ARCH) {
  const a = ARCHS.get(id ?? DEFAULT_ARCH);
  if (!a) throw new Error(`arquitectura desconocida: "${id}" (válidas: ${listArchs().join('|')})`);
  return a;
}

/**
 * Garantiza que cada paso `backend` del plan declare su arquitectura:
 * si la descripción ya la menciona ("arquitectura <id>") la respeta;
 * si no, appenda el bloque canónico de instrucciones del patrón.
 * Invariante del api-skeleton: server/routes/<name>.js siempre existe
 * como punto de montaje — lo que cambia es cuánta lógica vive ahí.
 */
export function applyArch(plan, arch) {
  const tag = `arquitectura ${arch.id}`;
  for (const s of plan.steps ?? []) {
    if (s.type !== 'backend') continue;
    if (s.description?.toLowerCase().includes(tag)) continue;
    s.description = `${s.description ?? ''}\n\n${arch.instructions}`;
  }
  plan.arch = arch.id;
  return plan;
}

/**
 * Bullet para planner.md: qué arquitectura deben declarar los pasos
 * backend en un plan escrito por Devin (appType custom).
 */
export function archRuleBullet(arch) {
  return (
    `- Los pasos \`backend\` deben organizar el código según la arquitectura ` +
    `**${arch.label}** y mencionarla en la descripción ("arquitectura ${arch.id}").`
  );
}
