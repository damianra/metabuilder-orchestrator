import viteReact from './vite-react.js';
import expressSqlite from './express-sqlite.js';
import expressPostgres from './express-postgres.js';
import expressMysql from './express-mysql.js';
import expressMongo from './express-mongo.js';
import nestTypeorm from './nest-typeorm.js';
import nextjs from './nextjs.js';

const STACKS = new Map(
  [viteReact, expressSqlite, expressPostgres, expressMysql, expressMongo, nestTypeorm, nextjs].map(
    (s) => [s.id, s],
  ),
);

export function getStack(id) {
  return STACKS.get(id) ?? null;
}

export function listStacks(kind) {
  return [...STACKS.values()].filter((s) => !kind || s.kind === kind);
}

/**
 * Stacks activos para un scope: `{ frontend, backend }` (null el que
 * no aplica). `overrides` = { frontend, backend } por id — reservado
 * para los pickers de stack (flags/dashboard). Los ids desconocidos
 * lanzan, nunca caen en silencio a un default distinto.
 */
export function resolveStacks(scope, overrides = {}) {
  const pick = (id) => {
    const s = STACKS.get(id);
    if (!s) throw new Error(`stack desconocido: "${id}"`);
    return s;
  };
  return {
    frontend: scope === 'backend' ? null : pick(overrides.frontend ?? 'vite-react'),
    backend: scope === 'frontend' ? null : pick(overrides.backend ?? 'express-sqlite'),
  };
}

// Fallback total si un override es inválido (ej. plan.json con typo
// en stacks) — un nodo no debe crashear por eso: cae a los defaults.
export function resolveStacksSafe(scope, overrides = {}) {
  try {
    return resolveStacks(scope, overrides);
  } catch {
    return resolveStacks(scope);
  }
}

// Overrides a aplicar desde el estado del grafo: los stacks persistidos
// en plan.json mandan (resume); si no, los flags/state del run.
export const stackOverrides = (state) =>
  state.plan?.stacks ?? {
    frontend: state.stackFrontend || undefined,
    backend: state.stackBackend || undefined,
  };

export const stacksFor = (state) => resolveStacksSafe(state.scope, stackOverrides(state));

// Ids resueltos como objeto persistible en plan.stacks.
export function stackIds(scope, overrides = {}) {
  const s = resolveStacksSafe(scope, overrides);
  return { frontend: s.frontend?.id ?? null, backend: s.backend?.id ?? null };
}

const active = (stacks) => [stacks.frontend, stacks.backend].filter(Boolean);

/**
 * Requisitos de plan merged de los stacks activos, deduplicados por
 * `error` (ambos stacks exigen el paso vitest con el mismo mensaje).
 */
export function planRequirements(stacks) {
  const seen = new Set();
  const reqs = [];
  for (const s of active(stacks)) {
    for (const r of s.requirements) {
      if (seen.has(r.error)) continue;
      seen.add(r.error);
      reqs.push(r);
    }
  }
  return reqs;
}

/**
 * Comandos de finalVerify en orden build → test → e2e por stack
 * (frontend primero), deduplicados por comando.
 */
export function finalCheckCommands(stacks) {
  const cmds = [];
  for (const s of active(stacks)) {
    for (const cmd of [s.verify.build, s.verify.test, s.verify.e2e].filter(Boolean)) {
      if (!cmds.includes(cmd)) cmds.push(cmd);
    }
  }
  return cmds;
}

/**
 * Bullets `- ...` con las reglas de stack para los prompts de planner
 * y plan-repair — misma fuente que validatePlan, así el prompt nunca
 * diverge del validador.
 */
export function stackRuleBullets(scope, overrides = {}) {
  const stacks = resolveStacks(scope, overrides);
  const parts = [
    stacks.frontend && `${stacks.frontend.label} (frontend)`,
    stacks.backend && `${stacks.backend.label} (backend)`,
    'Vitest (tests)',
    stacks.frontend && 'Playwright + Chromium (e2e)',
  ].filter(Boolean);
  const lines = [`- Stack de las apps: ${parts.join(', ')}.`];
  if (!stacks.backend)
    lines.push('- **scope `frontend`**: NO incluir pasos backend (nada de express/sqlite).');
  if (!stacks.frontend)
    lines.push('- **scope `backend`**: NO incluir pasos frontend (nada de framework UI/tailwind/playwright).');
  for (const r of planRequirements(stacks)) {
    if (r.prompt) lines.push(`- ${r.prompt}`);
  }
  return lines.join('\n');
}
