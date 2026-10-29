import viteReact from './vite-react.js';
import expressSqlite from './express-sqlite.js';
import expressPostgres from './express-postgres.js';
import expressMysql from './express-mysql.js';
import expressMongo from './express-mongo.js';
import nestTypeorm from './nest-typeorm.js';
import fastapi from './fastapi.js';
import nextjs from './nextjs.js';

const STACKS = new Map(
  [viteReact, expressSqlite, expressPostgres, expressMysql, expressMongo, nestTypeorm, fastapi, nextjs].map(
    (s) => [s.id, s],
  ),
);

export function getStack(id) {
  return STACKS.get(id) ?? null;
}

export function listStacks(kind) {
  return [...STACKS.values()].filter((s) => !kind || s.kind === kind);
}

const FRAMEWORK_LABELS = { express: 'Express', nest: 'NestJS', fastapi: 'FastAPI' };
const DB_LABELS = { sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL', mongo: 'MongoDB' };

/**
 * Resuelve (framework, db) → stackId backend. Cada def declara
 * `framework` + `dbs` cubiertos: express mapea 1:1 por db, nest
 * cubre pg/mysql/mongo via DB_TYPE, fastapi sqlite/pg/mysql via
 * DATABASE_URL. Combo inválido (framework desconocido o db no
 * soportada — fastapi+mongo queda fase 2) → null.
 */
export const resolveBackendStackId = (framework, db) =>
  listStacks('backend').find((s) => s.framework === framework && s.dbs?.includes(db))?.id ?? null;

// Matriz framework × db para los pickers (form Fullstack y Backend
// tab): { express: {label, dbs:[{id,label,stackId}]}, ... } — la UI
// filtra las dbs del framework elegido y resuelve el stackId.
export function backendMatrix() {
  const matrix = {};
  for (const s of listStacks('backend')) {
    if (!s.framework) continue;
    const cell = (matrix[s.framework] ??= {
      label: FRAMEWORK_LABELS[s.framework] ?? s.framework,
      dbs: [],
    });
    for (const db of s.dbs ?? []) {
      cell.dbs.push({ id: db, label: DB_LABELS[db] ?? db, stackId: s.id });
    }
  }
  return matrix;
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
 * (frontend primero), deduplicados por comando. Salen del
 * `toolchain` del stack — así un stack no-Node (pytest, uvicorn)
 * aporta los suyos sin tocar el finalizer.
 */
export function finalCheckCommands(stacks) {
  const cmds = [];
  for (const s of active(stacks)) {
    const tc = s.toolchain ?? {};
    for (const cmd of [tc.buildCmd, tc.testCmd, tc.e2eCmd].filter(Boolean)) {
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
  // Label de tests por toolchain activo, deduplicado — los stacks
  // node dicen Vitest; un stack python declara 'pytest' en
  // toolchain.testLabel.
  const testLabels = [...new Set(active(stacks).map((s) => s.toolchain?.testLabel ?? 'Vitest'))];
  const parts = [
    stacks.frontend && `${stacks.frontend.label} (frontend)`,
    stacks.backend && `${stacks.backend.label} (backend)`,
    ...testLabels.map((l) => `${l} (tests)`),
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
