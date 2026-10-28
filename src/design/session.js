// Sesión de diseño: workspace Vite+React fuera de generated-apps/
// (el scanner de proyectos lista todo ese dir) con chat iterativo.
// La memoria del chat vive en design-state.json — cada mensaje repliega
// el historial en el prompt (ACP no expone resume cross-session).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config } from '../config.js';
import { runAgentPrompt } from '../tools/acp.js';
import { startInstall, awaitInstall, clearInstall } from '../tools/install.js';
import { loadPrompt } from '../agents/common.js';
import { startDevRun, stopDevRun } from '../dashboard/server.js';

export const DESIGN_DIR = join(config.rootDir, 'design-work');
const statePath = join(DESIGN_DIR, 'design-state.json');

const readState = () => {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
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

export function designStatus() {
  if (!existsSync(join(DESIGN_DIR, 'package.json'))) return { exists: false, messages: [] };
  // URLs del dev server parseadas del log (el iframe del preview las
  // consume — vite imprime el puerto real al arrancar).
  let urls = [];
  try {
    const log = readFileSync(join(DESIGN_DIR, 'dev-run.log'), 'utf8');
    urls = [...new Set(log.match(/https?:\/\/localhost:\d+/g) ?? [])];
  } catch {
    /* sin dev-run.log todavía */
  }
  return { exists: true, ...readState(), urls };
}

// Crea el workspace copiando el app-skeleton (mismo contrato que
// preflight: agente nunca hace scaffolding desde cero).
export function createDesign() {
  if (existsSync(join(DESIGN_DIR, 'package.json'))) return { ok: false, error: 'ya existe un diseño en curso — descartalo o guardalo' };
  mkdirSync(DESIGN_DIR, { recursive: true });
  cpSync(join(config.templatesDir, 'app-skeleton'), DESIGN_DIR, { recursive: true });
  const agentsSrc = readFileSync(join(config.templatesDir, 'AGENTS.md'), 'utf8');
  writeFileSync(
    join(DESIGN_DIR, 'AGENTS.md'),
    agentsSrc.replaceAll('{{frontendStack}}', 'Vite + React + Tailwind'),
  );
  for (const f of ['package.json', 'index.html', 'src/App.jsx']) {
    const p = join(DESIGN_DIR, f);
    if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__APP_NAME__', 'design-work'));
  }
  writeState({ messages: [], created: new Date().toISOString() });
  startInstall(DESIGN_DIR);
  return { ok: true };
}

// Chat: onChunk(texto) llega por cada agent_message_chunk — el endpoint
// lo convierte en SSE. `agent` resuelve como el resto del sistema
// (settings/env > default).
export async function designChat(text, { agent = '', onChunk = () => {}, onActivity = () => {} } = {}) {
  if (!existsSync(join(DESIGN_DIR, 'package.json'))) return { ok: false, error: 'no hay diseño — crealo primero' };
  const install = await awaitInstall(DESIGN_DIR);
  if (!install?.ok) return { ok: false, error: `npm install falló: ${install?.stderr?.slice(-200) ?? ''}` };
  const state = readState();
  const history = state.messages
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Diseñador'}: ${m.text}`)
    .join('\n');
  const prompt =
    loadPrompt('designer', {}) +
    (history ? `\n\n## Conversación hasta ahora\n\n${history}\n\n` : '\n\n') +
    `Usuario: ${text}`;

  const res = await runAgentPrompt({
    agent,
    prompt,
    cwd: DESIGN_DIR,
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

const pidAlive = (pid) => {
  try {
    return pid ? process.kill(pid, 0) : false;
  } catch {
    return false;
  }
};

export const designDev = () => {
  if (!existsSync(join(DESIGN_DIR, 'package.json'))) {
    return { ok: false, error: 'no hay diseño — crealo primero' };
  }
  // Mismo guard que run-dev de proyectos: un run vigente con pid vivo
  // bloquea el relanzamiento (el primero quedaría huérfano en otro
  // puerto); `running` con pid muerto es stale y no bloquea.
  try {
    const st = JSON.parse(readFileSync(join(DESIGN_DIR, 'dev-run.json'), 'utf8'));
    if (st?.status === 'running' && (st.procs ?? []).some((p) => pidAlive(p.pid))) {
      return { ok: false, error: 'dev run en curso', status: 'running' };
    }
  } catch {
    /* sin dev-run.json → no corre nada */
  }
  const r = startDevRun(DESIGN_DIR, {});
  return { ...r, ok: r.status === 'running' };
};
export const designStopDev = () => stopDevRun(DESIGN_DIR);

// Guardar como app real: mueve el workspace a generated-apps/<slug>
// con un plan.json sintético — el resto del dashboard lo trata como
// cualquier app generada (dockerize, publish, resume).
const SAVE_EXCLUDE = new Set(['node_modules', 'design-state.json', 'dev-run.json', 'dev-run.log']);

export function saveDesign(slug) {
  if (!existsSync(join(DESIGN_DIR, 'package.json'))) return { ok: false, error: 'no hay diseño para guardar' };
  const dest = join(config.generatedAppsDir, slug);
  if (existsSync(dest)) return { ok: false, error: `ya existe ${slug}` };
  stopDevRun(DESIGN_DIR);
  mkdirSync(config.generatedAppsDir, { recursive: true });
  // Sin node_modules ni state files de sesión — la app guardada arranca
  // con install propio (awaitInstall) y sin el historial del chat.
  cpSync(DESIGN_DIR, dest, {
    recursive: true,
    filter: (src) => !SAVE_EXCLUDE.has(basename(src)),
  });
  rmSync(statePath, { force: true });
  writeFileSync(
    join(dest, 'plan.json'),
    JSON.stringify(
      {
        projectName: slug,
        scope: 'frontend',
        appType: 'custom',
        idea: 'diseño creado en la pestaña Diseñar app',
        compliance: ['privacidad', 'notfound'],
        validated: true,
        steps: [
          {
            id: 1,
            type: 'frontend',
            description: 'diseño iterado en chat',
            verify: 'npm run build',
            status: 'done',
            attempts: 1,
          },
        ],
      },
      null,
      2,
    ),
  );
  clearInstall(DESIGN_DIR); // la próxima creación reinstala de cero
  rmSync(DESIGN_DIR, { recursive: true, force: true });
  return { ok: true, slug };
}

export function discardDesign() {
  if (!existsSync(DESIGN_DIR)) return { ok: true };
  stopDevRun(DESIGN_DIR);
  clearInstall(DESIGN_DIR);
  rmSync(DESIGN_DIR, { recursive: true, force: true });
  return { ok: true };
}
