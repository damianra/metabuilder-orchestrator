// Registry de perfiles de cumplimiento — mismo patrón que src/stacks/
// y src/arch/: cada perfil es un archivo de datos (id, label, promptBlock
// que se inyecta en los pasos, requirements declarativos del validator
// con error+prompt equivalente, regex `infer` opcional para detección
// por idea).
import privacidad from './privacidad.js';
import notfound from './notfound.js';
import cookies from './cookies.js';
import terminos from './terminos.js';
import pagos from './pagos.js';
import auth from './auth.js';
import menores from './menores.js';

const PROFILES = new Map(
  [privacidad, notfound, cookies, terminos, pagos, auth, menores].map((p) => [p.id, p]),
);

// Perfiles base: se aplican SIEMPRE que el scope tenga frontend — el
// usuario no tiene que pedirlos (privacidad: las apps recolectan datos;
// notfound: toda app necesita su 404).
const BASE_FRONTEND = ['privacidad', 'notfound'];
// Perfiles que solo aplican con frontend / con backend según scope.
const NEEDS_FRONTEND = new Set(['privacidad', 'notfound', 'cookies', 'terminos', 'menores']);
const NEEDS_BACKEND = new Set(['auth']);

export const getCompliance = (id) => PROFILES.get(id) ?? null;
export const listCompliance = () => [...PROFILES.keys()];

const scopeOk = (id, scope) => {
  if (NEEDS_FRONTEND.has(id) && scope === 'backend') return false;
  if (NEEDS_BACKEND.has(id) && scope === 'frontend') return false;
  return true;
};

/**
 * Resuelve los perfiles activos: base por scope + inferencia por la
 * idea (regex `infer` de cada perfil) + ids explícitos (flag
 * --compliance a,b,c). Los explícitos inválidos lanzan — nunca se
 * descartan en silencio.
 */
export function resolveCompliance({ idea = '', scope = 'fullstack', flag = null } = {}) {
  const ids = new Set(scope === 'backend' ? [] : BASE_FRONTEND);
  for (const id of String(flag ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!PROFILES.has(id)) {
      throw new Error(`compliance desconocido "${id}" (${listCompliance().join('|')})`);
    }
    ids.add(id);
  }
  const t = idea.toLowerCase();
  for (const p of PROFILES.values()) if (p.infer?.test(t)) ids.add(p.id);
  return [...ids].filter((id) => scopeOk(id, scope));
}

/**
 * Precedencia como stacksFor/plan.stacks: flag explícito > persistido
 * en plan.compliance > inferencia por idea+scope.
 */
export function complianceFor({ idea = '', scope = 'fullstack', flag = null, plan = null } = {}) {
  if (flag) return resolveCompliance({ idea, scope, flag });
  if (Array.isArray(plan?.compliance) && plan.compliance.length) return plan.compliance;
  return resolveCompliance({ idea, scope });
}

// Requisitos del validator para los perfiles activos (misma fuente que
// los bullets del planner — una sola verdad como en los stacks).
export const complianceRequirements = (ids) =>
  ids.flatMap((id) => PROFILES.get(id)?.requirements ?? []);

// Bullets para prompts planner/plan-repair.
export const complianceRuleBullets = (ids) =>
  complianceRequirements(ids).map((r) => r.prompt).filter(Boolean);

// Dirs de overlay por perfil activo (src/compliance/overlays/<id>/) —
// archivos que preflight copia al proyecto (componentes listos, no
// prompt-only: el agente los integra en vez de escribirlos de cero).
export const complianceOverlayDirs = (ids) =>
  ids
    .map((id) => PROFILES.get(id)?.overlayDir)
    .filter(Boolean)
    .map((d) => `overlays/${d}`);

/**
 * Garantiza que el plan declare los perfiles activos: si algún step
 * del tipo requerido ya cumple las keywords del perfil, se respeta;
 * si no, se appenda el promptBlock canónico al step relevante —
 * mismo patrón que applyArch (backend) pero por keywords.
 */
export function applyCompliance(plan, ids) {
  const steps = plan.steps ?? [];
  for (const id of ids) {
    const p = PROFILES.get(id);
    if (!p?.promptBlock) continue;
    const covered = p.requirements.every((r) =>
      steps.some((s) => {
        const t = `${s.description ?? ''} ${s.verify ?? ''}`.toLowerCase();
        return (r.type === null || s.type === r.type) && r.keywords.every((k) => t.includes(k));
      }),
    );
    if (covered) continue;
    const wanted = p.requirements.find((r) => r.type)?.type;
    const target =
      steps.find((s) => s.type === wanted) ??
      steps.find((s) => s.type === 'frontend') ??
      steps.find((s) => s.type === 'backend') ??
      steps[0];
    if (target) target.description = `${target.description ?? ''}\n${p.promptBlock}`;
  }
  if (steps.length) plan.compliance = ids;
  return plan;
}
