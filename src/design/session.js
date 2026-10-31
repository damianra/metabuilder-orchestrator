// Sesión de diseño: workspace Vite+React fuera de generated-apps/
// (el scanner de proyectos lista todo ese dir) con chat iterativo.
// La memoria del chat vive en design-state.json — cada mensaje repliega
// el historial en el prompt (ACP no expone resume cross-session).
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config } from '../config.js';
import { runAgentPrompt } from '../tools/acp.js';
import { startInstall, awaitInstall, clearInstall } from '../tools/install.js';
import { loadPrompt } from '../agents/common.js';
import { startDevRun, stopDevRun } from '../dashboard/server.js';
import { apiSurfaceFor, apiSurfaceKindOf } from '../tools/api-surface.js';
import { detectBackendStackId } from '../tools/docker.js';
import { writeAgentsMd } from '../agents/preflight.js';
import { resolveArchSafe } from '../arch/index.js';
import { getStack } from '../stacks/index.js';

export const DESIGN_DIR = join(config.rootDir, 'design-work');
const statePath = join(DESIGN_DIR, 'design-state.json');

// Idle-parking: el vite dev del workspace se frena solo tras
// config.designIdleMs sin actividad. El poll de designStatus (cada 3s
// desde DesignTab) ES la señal de presencia — tab abierta = alguien
// mirando; al cerrarla el timer vence y el sweeper apaga el preview.
// Inicializado al cargar el módulo: tras un restart de la API un dev
// run huérfano tiene un grace period completo antes del park.
let lastActivityAt = Date.now();
const touchActivity = () => {
  lastActivityAt = Date.now();
};

// Barrido llamado por el setInterval de main() (no por requests: con
// la tab cerrada nadie llama designStatus, que es justo cuando hay
// que frenar). Params inyectables para tests — tocar DESIGN_DIR real
// o el dev run de una sesión viva sería destructivo.
export function designIdleSweep({
  now = Date.now(),
  idleMs = config.designIdleMs,
  lastActivity = lastActivityAt,
  stop = designStopDev,
} = {}) {
  if (idleMs <= 0 || now - lastActivity < idleMs) return { parked: false };
  const r = stop();
  if (!r?.stopped) return { parked: false };
  lastActivityAt = now; // ya frenó — el próximo barrido no reprocesa
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

export function designStatus(dir = DESIGN_DIR) {
  touchActivity();
  if (!existsSync(join(dir, 'package.json'))) return { exists: false, messages: [] };
  // URLs solo con el run vivo: dev-run.log es append-only y tras
  // stop-dev seguiría reportando la URL vieja con el iframe muerto
  // (mismo gate que devRun.status/stale en el detalle de proyecto).
  let devRunning = false;
  try {
    const st = JSON.parse(readFileSync(join(dir, 'dev-run.json'), 'utf8'));
    devRunning = st?.status === 'running' && (st.procs ?? []).some((p) => pidAlive(p.pid));
  } catch {
    /* sin dev-run.json → nunca corrió */
  }
  let urls = [];
  if (devRunning) {
    try {
      const log = readFileSync(join(dir, 'dev-run.log'), 'utf8');
      urls = [...new Set(log.match(/https?:\/\/localhost:\d+/g) ?? [])];
    } catch {
      /* sin dev-run.log todavía */
    }
  }
  return { exists: true, ...readState(join(dir, 'design-state.json')), urls, devRunning };
}

// Crea el workspace copiando el app-skeleton (mismo contrato que
// preflight: agente nunca hace scaffolding desde cero). `attachTo`
// (v10) ata el diseño a un proyecto backend existente: el chat diseña
// contra su API real y `saveDesign` copia el front dentro del mismo
// proyecto en vez de crear uno nuevo.
export function createDesign({ attachTo = null, frontendStackId = 'vite-react' } = {}) {
  const fst = getStack(frontendStackId)?.kind === 'frontend' ? getStack(frontendStackId) : getStack('vite-react');
  touchActivity();
  if (existsSync(join(DESIGN_DIR, 'package.json'))) return { ok: false, error: 'ya existe un diseño en curso — descartalo o guardalo' };
  mkdirSync(DESIGN_DIR, { recursive: true });
  cpSync(join(config.templatesDir, fst.skeletonDir ?? 'app-skeleton'), DESIGN_DIR, { recursive: true });
  // El design-work no tiene backend — usa writeAgentsMd directo (asi
  // aplica el pruning de secciones y no quedan placeholders residuales).
  writeAgentsMd(DESIGN_DIR, {
    withBackend: false,
    withFrontend: true,
    frontendStack: fst,
    backendStack: null,
  });
  for (const f of ['package.json', 'index.html', 'src/App.jsx', 'src/app/page.jsx', 'src/app/layout.jsx']) {
    const p = join(DESIGN_DIR, f);
    if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__APP_NAME__', 'design-work'));
  }
  writeState({ messages: [], created: new Date().toISOString(), attachTo, frontendStackId: fst.id });
  startInstall(DESIGN_DIR);
  return { ok: true };
}

// Chat: onChunk(texto) llega por cada agent_message_chunk — el endpoint
// lo convierte en SSE. `agent` resuelve como el resto del sistema
// (settings/env > default).
export async function designChat(text, { agent = '', onChunk = () => {}, onActivity = () => {} } = {}) {
  touchActivity();
  if (!existsSync(join(DESIGN_DIR, 'package.json'))) return { ok: false, error: 'no hay diseño — crealo primero' };
  const install = await awaitInstall(DESIGN_DIR);
  if (!install?.ok) return { ok: false, error: `npm install falló: ${install?.stderr?.slice(-200) ?? ''}` };
  const state = readState();
  const history = state.messages
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Diseñador'}: ${m.text}`)
    .join('\n');
  // Backend attachado: la API real se inyecta en el prompt — el
  // diseñador construye la UI contra esos endpoints (nada de mocks)
  // y el proxy de vite del workspace (:4000) la hace funcional.
  const apiContext = apiContextBlock(state.attachTo);
  const prompt =
    loadPrompt('designer', {}) +
    apiContext +
    (history ? `\n\n## Conversación hasta ahora\n\n${history}\n\n` : '\n\n') +
    `Usuario: ${text}`;

  // Guardar el prompt ANTES del agente: si el turno muere (timeout)
  // el mensaje ya quedó → plan.idea conserva el prompt real.
  state.messages.push({ role: 'user', text });
  writeState(state);
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
  state.messages.push({ role: 'agent', text: reply });
  writeState(state);
  return { ok: true, text: reply };
}

// Bloque de contexto de API real para el prompt del diseñador —
// '' cuando el diseño no está attachado (standalone) o el backend
// no expone routes escaneables.
export function apiContextBlock(attachTo, appsDir = config.generatedAppsDir) {
  if (!attachTo) return '';
  const eps = apiSurfaceFor(join(appsDir, attachTo), {
    kind: apiSurfaceKindOf(detectBackendStackId(join(appsDir, attachTo))),
  });
  if (!eps.length) return '';
  return (
    `\n\n## API real del backend "${attachTo}"\n\n` +
    'El backend YA EXISTE y corre en :4000 — el proxy de Vite reenvía /api y /uploads. ' +
    'Diseñá la UI llamando estos endpoints reales con fetch (SIN datos mock — la integración ya está hecha):\n\n' +
    eps.map((e) => `- ${e.method} ${e.path}`).join('\n') +
    '\n'
  );
}

export const designDev = () => {
  touchActivity();
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

// Attach (v10): el front del workspace se copia DENTRO del proyecto
// backend — nunca se pisan package.json/AGENTS.md/.gitignore/server/.
const ATTACH_EXCLUDE = new Set([
  ...SAVE_EXCLUDE,
  'package.json',
  'package-lock.json', // el del backend queda — npm install lo regenera con las deps mergeadas
  'AGENTS.md',
  '.gitignore',
  '.git',
  'dist',
]);

// Copia el front a un proyecto backend + merge del package.json por
// clave (los scripts/deps del backend ganan en colisiones). Puro —
// testeable en tmpdir.
export function attachFrontendFiles(srcDir, destDir) {
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src) => !ATTACH_EXCLUDE.has(basename(src)),
  });
  const pkgPath = join(destDir, 'package.json');
  const frontPkg = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8'));
  // Backend sin package.json (fastapi: requirements.txt): no hay nada
  // que mergear — el package.json del front queda como el del proyecto.
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify(frontPkg, null, 2) + '\n');
  } else {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    // backend gana en clashes de scripts (test/api/dev:api) — el front
    // solo agrega dev/build/preview/test:e2e que el back no define.
    pkg.scripts = { ...(frontPkg.scripts ?? {}), ...(pkg.scripts ?? {}) };
    // En deps también gana el backend en clashes de versión (consistencia
    // con scripts: el proyecto preexistente es la autoridad).
    for (const f of ['dependencies', 'devDependencies']) {
      pkg[f] = { ...(frontPkg[f] ?? {}), ...(pkg[f] ?? {}) };
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  const giSrc = join(srcDir, '.gitignore');
  if (existsSync(giSrc)) appendFileSync(join(destDir, '.gitignore'), '\n' + readFileSync(giSrc, 'utf8'));
}

// plan.json del backend → fullstack: stacks.frontend, compliance base
// y un step `done` sintético del front (misma técnica que saveDesign).
export function attachPlanUpdate(destDir, frontendStackId = 'vite-react') {
  const planPath = join(destDir, 'plan.json');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  plan.scope = 'fullstack';
  plan.stacks = { ...(plan.stacks ?? {}), frontend: frontendStackId };
  plan.compliance = [...new Set([...(plan.compliance ?? []), 'privacidad', 'notfound'])];
  const nextId = Math.max(0, ...(plan.steps ?? []).map((s) => s.id ?? 0)) + 1;
  (plan.steps ??= []).push({
    id: nextId,
    type: 'frontend',
    description:
      'Frontend implementado iterando en chat de diseño — UI React + Vite + Tailwind aplicando las reglas de UI del AGENTS.md',
    verify: 'npm run build',
    status: 'done',
    attempts: 1,
  });
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
}

async function saveDesignAttach(slug) {
  const dest = join(config.generatedAppsDir, slug);
  const planPath = join(dest, 'plan.json');
  if (!existsSync(dest) || !existsSync(planPath)) return { ok: false, error: `no existe el backend ${slug}` };
  if (existsSync(join(dest, 'index.html')) || existsSync(join(dest, 'src'))) {
    return { ok: false, error: `${slug} ya tiene frontend` };
  }
  stopDevRun(DESIGN_DIR);
  // Snapshot para rollback: si el install falla, el backend queda con
  // package.json envenenado + front copiado + retry bloqueado por el
  // guard "ya tiene frontend" — restaurar package.json y borrar solo
  // lo que el copy agregó (lo que ya existía se conserva). Backend
  // python (sin package.json): el backup es null y el rollback borra
  // el package.json que el attach creó.
  const destPkg = join(dest, 'package.json');
  const pkgBackup = existsSync(destPkg) ? readFileSync(destPkg, 'utf8') : null;
  const preexisting = new Set(readdirSync(dest));
  attachFrontendFiles(DESIGN_DIR, dest);
  // Las deps del front se mergearon al package.json del backend →
  // install en dest (sin rm si falla: es un proyecto backend real).
  clearInstall(dest);
  startInstall(dest);
  const aInstall = await awaitInstall(dest);
  if (!aInstall?.ok) {
    if (pkgBackup === null) rmSync(destPkg, { force: true });
    else writeFileSync(destPkg, pkgBackup);
    for (const f of readdirSync(DESIGN_DIR).filter((n) => !ATTACH_EXCLUDE.has(n) && !preexisting.has(n))) {
      rmSync(join(dest, f), { recursive: true, force: true });
    }
    return { ok: false, error: `npm install en ${slug} falló: ${aInstall?.stderr?.slice(-200) ?? ''}` };
  }
  attachPlanUpdate(dest, readState().frontendStackId ?? 'vite-react');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  writeAgentsMd(dest, {
    withBackend: true,
    whatsapp:
      plan.appType === 'orders' || /whats|wa\.me/i.test(plan.idea ?? ''),
    arch: resolveArchSafe(plan.arch, 'flat'),
    frontendStack: getStack(readState().frontendStackId ?? 'vite-react'),
    backendStack: getStack(plan.stacks?.backend ?? detectBackendStackId(dest)),
  });
  clearInstall(DESIGN_DIR);
  rmSync(DESIGN_DIR, { recursive: true, force: true });
  return { ok: true, slug };
}

export async function saveDesign(slug) {
  if (!existsSync(join(DESIGN_DIR, 'package.json'))) return { ok: false, error: 'no hay diseño para guardar' };
  // Modo attach: el target viene de design-state (se eligió al crear),
  // no del input — slug del body se ignora.
  const attachTo = readState().attachTo;
  if (attachTo) return saveDesignAttach(attachTo);
  const dest = join(config.generatedAppsDir, slug);
  if (existsSync(dest)) return { ok: false, error: `ya existe ${slug}` };
  stopDevRun(DESIGN_DIR);
  mkdirSync(config.generatedAppsDir, { recursive: true });
  // Sin node_modules ni state files de sesión — la app guardada arranca
  // con install propio (awaitInstall en dest) y sin el historial del chat.
  cpSync(DESIGN_DIR, dest, {
    recursive: true,
    filter: (src) => !SAVE_EXCLUDE.has(basename(src)),
  });
  // node_modules quedó fuera del copy → install propio en el destino.
  clearInstall(dest); // la cache por dir devuelve resultado viejo sin re-correr
  startInstall(dest);
  const install = await awaitInstall(dest);
  if (!install?.ok) {
    rmSync(dest, { recursive: true, force: true }); // no dejar slug ocupado
    return { ok: false, error: `npm install en ${slug} falló: ${install?.stderr?.slice(-200) ?? ''}` };
  }
  const state = readState(); // leer antes de borrar statePath (plan usa messages/created)
  rmSync(statePath, { force: true });
  writeFileSync(
    join(dest, 'plan.json'),
    JSON.stringify(
      {
        projectName: slug,
        scope: 'frontend',
        appType: 'custom',
        idea: state.messages?.find((m) => m.role === 'user')?.text
              ?? 'diseño creado en la pestaña Diseñar app',
        timings: {
          startedAt: state.created ?? null,
          finishedAt: new Date().toISOString(),
        },
        compliance: ['privacidad', 'notfound'],
        stacks: { frontend: state.frontendStackId ?? 'vite-react' },
        validated: true,
        steps: [
          {
            id: 1,
            type: 'frontend',
            // Descripción compliant: las keywords (Vite/UI) mantienen el
            // plan legible por validatePlan aunque se pierda el flag
            // validated — y el extend las reutiliza al re-validar.
            description:
              'Frontend implementado iterando en chat de diseño — UI React + Vite + Tailwind aplicando las reglas de UI del AGENTS.md',
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
  writeFileSync(
    join(dest, 'status.json'),
    JSON.stringify({ status: 'done', finishedAt: new Date().toISOString() }, null, 2),
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
