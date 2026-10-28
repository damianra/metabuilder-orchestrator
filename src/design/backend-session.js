// Sesión de backend-experto: workspace api-skeleton en backend-work/
// (fuera de generated-apps/) con chat iterativo — espejo de
// session.js (diseño) pero el "preview" es la API corriendo en :4000
// y su api-surface en vez de un iframe de vite.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config } from '../config.js';
import { runAgentPrompt } from '../tools/acp.js';
import { startInstall, awaitInstall, clearInstall } from '../tools/install.js';
import { loadPrompt } from '../agents/common.js';
import { startDevRun, stopDevRun } from '../dashboard/server.js';
import { apiSurfaceFor } from '../tools/api-surface.js';
import { copyApiSkeleton, writeAgentsMd } from '../agents/preflight.js';

export const BACKEND_DIR = join(config.rootDir, 'backend-work');
const statePath = join(BACKEND_DIR, 'backend-state.json');

// Idle-parking: misma semántica que el diseño — el api dev-run del
// workspace se frena tras designIdleMs sin actividad (el poll del tab
// es la señal de presencia).
let lastActivityAt = Date.now();
const touchActivity = () => {
  lastActivityAt = Date.now();
};

export function backendIdleSweep({
  now = Date.now(),
  idleMs = config.designIdleMs,
  lastActivity = lastActivityAt,
  stop = backendStopDev,
} = {}) {
  if (idleMs <= 0 || now - lastActivity < idleMs) return { parked: false };
  const r = stop();
  if (!r?.stopped) return { parked: false };
  lastActivityAt = now;
  return { parked: true };
}

const readState = (p = statePath) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { messages: [], created: null };
  }
};
const writeState = (s) => {
  try {
    writeFileSync(statePath, JSON.stringify(s));
  } catch {
    /* dir borrado a mitad de operación */
  }
};

const pidAlive = (pid) => {
  try {
    return pid ? process.kill(pid, 0) : false;
  } catch {
    return false;
  }
};

export function backendStatus(dir = BACKEND_DIR) {
  touchActivity();
  if (!existsSync(join(dir, 'package.json'))) return { exists: false, messages: [] };
  let apiRunning = false;
  try {
    const st = JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8'));
    apiRunning = st?.status === 'running' && (st.procs ?? []).some((p) => pidAlive(p.pid));
  } catch {
    /* sin dev-run.json */
  }
  return { exists: true, ...readState(join(dir, 'backend-state.json')), apiRunning, apiSurface: apiSurfaceFor(dir) };
}

// Crea el workspace copiando el api-skeleton — reuse de
// copyApiSkeleton (preflight): promueve package.partial.json →
// package.json y gitignore.partial → .gitignore (sin esto el publish
// de la app guardada commitearía .env/*.sqlite/node_modules).
export function createBackend() {
  touchActivity();
  if (existsSync(join(BACKEND_DIR, 'package.json'))) {
    return { ok: false, error: 'ya existe una sesión de backend — descartala o guardala' };
  }
  mkdirSync(BACKEND_DIR, { recursive: true });
  copyApiSkeleton(BACKEND_DIR);
  writeState({ messages: [], created: new Date().toISOString() });
  startInstall(BACKEND_DIR);
  return { ok: true };
}

export async function backendChat(text, { agent = '', onChunk = () => {}, onActivity = () => {} } = {}) {
  touchActivity();
  if (!existsSync(join(BACKEND_DIR, 'package.json'))) return { ok: false, error: 'no hay sesión — creala primero' };
  const install = await awaitInstall(BACKEND_DIR);
  if (!install?.ok) return { ok: false, error: `npm install falló: ${install?.stderr?.slice(-200) ?? ''}` };
  const state = readState();
  const history = state.messages
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Experto'}: ${m.text}`)
    .join('\n');
  const prompt =
    loadPrompt('backend-designer', {}) +
    (history ? `\n\n## Conversación hasta ahora\n\n${history}\n\n` : '\n\n') +
    `Usuario: ${text}`;

  const res = await runAgentPrompt({
    agent,
    prompt,
    cwd: BACKEND_DIR,
    onText: onChunk,
    onActivity,
    logPath: null,
  });
  if (!res.ok) return { ok: false, error: res.error, text: res.text };
  const reply = res.text || '(sin respuesta)';
  state.messages.push({ role: 'user', text }, { role: 'agent', text: reply });
  writeState(state);
  return { ok: true, text: reply };
}

export const backendDev = () => {
  touchActivity();
  if (!existsSync(join(BACKEND_DIR, 'package.json'))) {
    return { ok: false, error: 'no hay sesión — creala primero' };
  }
  try {
    const st = JSON.parse(readFileSync(join(BACKEND_DIR, 'dev-run.json'), 'utf8'));
    if (st?.status === 'running' && (st.procs ?? []).some((p) => pidAlive(p.pid))) {
      return { ok: false, error: 'dev run en curso', status: 'running' };
    }
  } catch {
    /* sin dev-run.json → no corre nada */
  }
  const r = startDevRun(BACKEND_DIR, {});
  return { ...r, ok: r.status === 'running' };
};
export const backendStopDev = () => stopDevRun(BACKEND_DIR);

// Guardar como app real: mueve el workspace a generated-apps/<slug>
// con plan.json sintético scope:backend (mismo contrato que
// saveDesign — dockerize/publish/resume quedan habilitadas).
const SAVE_EXCLUDE = new Set(['node_modules', 'backend-state.json', 'dev-run.json', 'dev-run.log']);

export function saveBackend(slug) {
  if (!existsSync(join(BACKEND_DIR, 'package.json'))) return { ok: false, error: 'no hay sesión para guardar' };
  const dest = join(config.generatedAppsDir, slug);
  if (existsSync(dest)) return { ok: false, error: `ya existe ${slug}` };
  stopDevRun(BACKEND_DIR);
  mkdirSync(config.generatedAppsDir, { recursive: true });
  cpSync(BACKEND_DIR, dest, {
    recursive: true,
    filter: (src) => !SAVE_EXCLUDE.has(basename(src)),
  });
  rmSync(statePath, { force: true });
  writeFileSync(
    join(dest, 'plan.json'),
    JSON.stringify(
      {
        projectName: slug,
        scope: 'backend',
        appType: 'custom',
        arch: 'flat',
        idea: 'api creada en la pestaña Backend (chat experto)',
        stacks: { backend: 'express-sqlite' },
        validated: true,
        steps: [
          {
            id: 1,
            type: 'backend',
            description:
              'API implementada iterando en chat de backend — Express + SQLite sobre api-skeleton con arquitectura flat',
            verify: 'npm test',
            status: 'done',
            attempts: 1,
          },
        ],
      },
      null,
      2,
    ),
  );
  // name del package + AGENTS.md por detección (scope backend →
  // reglas de arquitectura + API surface; igual que el pipeline).
  try {
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
    pkg.name = slug;
    writeFileSync(join(dest, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  } catch {
    /* package.json siempre existe en el workspace */
  }
  writeAgentsMd(
    JSON.parse(readFileSync(join(dest, 'plan.json'), 'utf8')),
    dest,
  );
  clearInstall(BACKEND_DIR);
  rmSync(BACKEND_DIR, { recursive: true, force: true });
  return { ok: true, slug };
}

export function discardBackend() {
  if (!existsSync(BACKEND_DIR)) return { ok: true };
  stopDevRun(BACKEND_DIR);
  clearInstall(BACKEND_DIR);
  rmSync(BACKEND_DIR, { recursive: true, force: true });
  return { ok: true };
}
