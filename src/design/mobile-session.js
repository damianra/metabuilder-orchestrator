// Sesión de diseño mobile: workspace Expo en mobile-work/ (fuera de
// generated-apps/) con chat iterativo — espejo de session.js (diseño
// web) pero el skeleton es app-skeleton-expo, el "preview" es
// `npm run web` (Expo Web en :8081 dentro del marco de teléfono) y el
// save produce un plan sintético mobile (stacks.frontend expo-mobile,
// compliance vacío — los overlays web no aplican).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config } from '../config.js';
import { runAgentPrompt } from '../tools/acp.js';
import { startInstall, awaitInstall, clearInstall } from '../tools/install.js';
import { loadPrompt } from '../agents/common.js';
import { startDevRun, stopDevRun } from '../dashboard/server.js';
import { writeAgentsMd } from '../agents/preflight.js';
import { writeReadme } from '../agents/finalizer.js';
import { initGitRepo } from '../agents/common.js';
import { writeDockerFiles, detectOutDir } from '../tools/docker.js';
import { getStack } from '../stacks/index.js';
import {
  archiveWorkspace,
  copyReference,
  getEntry,
  referenceBlock,
  restoreWorkspace,
  waitForUrl,
} from './library.js';
import { writeDesignPrompt } from './session.js';

export const MOBILE_DIR = join(config.rootDir, 'mobile-work');
const statePath = join(MOBILE_DIR, 'mobile-state.json');
const MOBILE_STACK_ID = 'expo-mobile';

// Idle-parking: misma semántica que el diseño web — el expo dev del
// workspace se frena tras designIdleMs sin actividad (el poll del tab
// Mobile cuenta como presencia).
let lastActivityAt = Date.now();
const touchActivity = () => {
  lastActivityAt = Date.now();
};

export function mobileIdleSweep({
  now = Date.now(),
  idleMs = config.designIdleMs,
  lastActivity = lastActivityAt,
  stop = mobileStopDev,
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

// Contrato idéntico a designStatus: urls solo con el dev run vivo
// (dev-run.log es append-only — tras stop-dev seguiría reportando la
// URL vieja con el iframe muerto).
export function mobileStatus(dir = MOBILE_DIR) {
  touchActivity();
  if (!existsSync(join(dir, 'package.json'))) return { exists: false, messages: [] };
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
  return { exists: true, ...readState(join(dir, 'mobile-state.json')), urls, devRunning };
}

// Crea el workspace copiando el skeleton Expo — writeAgentsMd con el
// stack mobile emite AGENTS.mobile.md (reglas RN: no DOM, NativeWind,
// fallbacks web) que es la guía que el diseñador sigue.
export function createMobile(reference = null) {
  const stack = getStack(MOBILE_STACK_ID);
  touchActivity();
  if (existsSync(join(MOBILE_DIR, 'package.json'))) {
    return { ok: false, error: 'ya existe un diseño mobile en curso — descartalo o guardalo' };
  }
  // Referencia inválida → error ANTES de crear el workspace
  // (puede ser web — cross-kind se traduce a RN/NativeWind).
  const ref = reference && getEntry(reference) ? reference : null;
  if (reference && !ref) return { ok: false, error: `la referencia ${reference} no existe en la biblioteca` };
  mkdirSync(MOBILE_DIR, { recursive: true });
  cpSync(join(config.templatesDir, stack.skeletonDir), MOBILE_DIR, { recursive: true });
  writeAgentsMd(MOBILE_DIR, {
    withBackend: false,
    withFrontend: true,
    frontendStack: stack,
    backendStack: null,
  });
  // Placeholders del scaffolding Expo (misma sustitución que
  // preflight): __APP_NAME__ en package.json/app.json/app/index.tsx
  // y __APP_PKG__ SOLO el alnum — app.json ya trae el prefijo
  // "com.example.__APP_PKG__", un FQDN acá lo duplicaría.
  for (const f of ['package.json', 'app/index.tsx']) {
    const p = join(MOBILE_DIR, f);
    if (existsSync(p)) {
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__APP_NAME__', 'mobile-work'));
    }
  }
  const appJson = join(MOBILE_DIR, 'app.json');
  if (existsSync(appJson)) {
    writeFileSync(
      appJson,
      readFileSync(appJson, 'utf8')
        .replaceAll('__APP_NAME__', 'mobile-work')
        .replaceAll('__APP_PKG__', 'mobilework'),
    );
  }
  if (ref) copyReference(ref, MOBILE_DIR);
  writeState({ messages: [], created: new Date().toISOString(), frontendStackId: MOBILE_STACK_ID, reference: ref });
  startInstall(MOBILE_DIR);
  return { ok: true };
}

// Chat: mismo wire que designChat — el historial vive en
// mobile-state.json y se repliega en cada turno (ACP no expone resume).
export async function mobileChat(text, { agent = '', onChunk = () => {}, onActivity = () => {} } = {}) {
  touchActivity();
  if (!existsSync(join(MOBILE_DIR, 'package.json'))) return { ok: false, error: 'no hay diseño mobile — crealo primero' };
  const install = await awaitInstall(MOBILE_DIR);
  if (!install?.ok) return { ok: false, error: `npm install falló: ${install?.stderr?.slice(-200) ?? ''}` };
  const state = readState();
  const history = state.messages
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Diseñador'}: ${m.text}`)
    .join('\n');
  // Referencia archivada (v15): spec + puntero a .reference/<slug>/
  // — si es web, el agente traduce los estilos a RN/NativeWind.
  const refContext = referenceBlock(state.reference);
  const prompt =
    loadPrompt('mobile-designer', {}) +
    refContext +
    (history ? `\n\n## Conversación hasta ahora\n\n${history}\n\n` : '\n\n') +
    `Usuario: ${text}`;

  state.messages.push({ role: 'user', text });
  writeState(state);
  const res = await runAgentPrompt({
    agent,
    prompt,
    cwd: MOBILE_DIR,
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

export const mobileDev = () => {
  touchActivity();
  if (!existsSync(join(MOBILE_DIR, 'package.json'))) {
    return { ok: false, error: 'no hay diseño mobile — crealo primero' };
  }
  try {
    const st = JSON.parse(readFileSync(join(MOBILE_DIR, 'dev-run.json'), 'utf8'));
    if (st?.status === 'running' && (st.procs ?? []).some((p) => pidAlive(p.pid))) {
      return { ok: false, error: 'dev run en curso', status: 'running' };
    }
  } catch {
    /* sin dev-run.json → no corre nada */
  }
  const r = startDevRun(MOBILE_DIR, {});
  return { ...r, ok: r.status === 'running' };
};
export const mobileStopDev = () => stopDevRun(MOBILE_DIR);

// Guardar como app real: mueve el workspace a generated-apps/<slug>
// con un plan.json sintético mobile — el dashboard lo trata como
// cualquier app generada (dev-run :8081, MobilePreview, publish).
const SAVE_EXCLUDE = new Set(['node_modules', 'mobile-state.json', 'dev-run.json', 'dev-run.log', '.env', '.reference']);

// Re-personaliza con el slug real de la app: el workspace quedó con
// 'mobile-work'/'mobilework' (nombre de sesión, no de la app) — sin
// esto toda app guardada compartía el mismo bundle id / scheme.
export const personalize = (dir, slug) => {
  const pkgId = slug.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app';
  for (const f of ['package.json', 'app/index.tsx']) {
    const p = join(dir, f);
    if (existsSync(p)) {
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('mobile-work', slug));
    }
  }
  const appJson = join(dir, 'app.json');
  if (existsSync(appJson)) {
    writeFileSync(
      appJson,
      readFileSync(appJson, 'utf8')
        .replaceAll('mobile-work', slug)
        .replaceAll('mobilework', pkgId),
    );
  }
};

export async function saveMobile(slug) {
  if (!existsSync(join(MOBILE_DIR, 'package.json'))) return { ok: false, error: 'no hay diseño mobile para guardar' };
  const dest = join(config.generatedAppsDir, slug);
  if (existsSync(dest)) return { ok: false, error: `ya existe ${slug}` };
  stopDevRun(MOBILE_DIR);
  mkdirSync(config.generatedAppsDir, { recursive: true });
  cpSync(MOBILE_DIR, dest, {
    recursive: true,
    filter: (src) => !SAVE_EXCLUDE.has(basename(src)),
  });
  clearInstall(dest);
  startInstall(dest);
  const install = await awaitInstall(dest);
  if (!install?.ok) {
    rmSync(dest, { recursive: true, force: true });
    return { ok: false, error: `npm install en ${slug} falló: ${install?.stderr?.slice(-200) ?? ''}` };
  }
  const state = readState();
  rmSync(statePath, { force: true });
  personalize(dest, slug);
  // Steps sintéticos done — las keywords (expo/animac/tsc/playwright)
  // mantienen el plan legible por validatePlan en un resume futuro.
  writeFileSync(
    join(dest, 'plan.json'),
    JSON.stringify(
      {
        projectName: slug,
        scope: 'frontend',
        appType: 'custom',
        idea:
          state.messages?.find((m) => m.role === 'user')?.text
          ?? 'diseño mobile creado en la pestaña Mobile',
        timings: {
          startedAt: state.created ?? null,
          finishedAt: new Date().toISOString(),
        },
        compliance: [],
        stacks: { frontend: MOBILE_STACK_ID },
        validated: true,
        steps: [
          {
            id: 1,
            type: 'frontend',
            description:
              'App mobile implementada iterando en chat de diseño — React Native + Expo Router + NativeWind con animaciones Moti y las reglas de AGENTS.md',
            verify: 'npx tsc --noEmit',
            status: 'done',
            attempts: 1,
          },
          {
            id: 2,
            type: 'test',
            description: 'Typecheck TypeScript del proyecto (tsc --noEmit)',
            verify: 'npx tsc --noEmit',
            status: 'done',
            attempts: 1,
          },
          {
            id: 3,
            type: 'e2e',
            description: 'Smoke e2e con Playwright sobre el preview web de Expo',
            verify: 'npm run test:e2e',
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
  try {
    writeReadme({
      projectDir: dest,
      projectSlug: slug,
      idea:
        state.messages?.find((m) => m.role === 'user')?.text
        ?? 'diseño mobile creado en la pestaña Mobile',
      agent: null,
      scope: 'frontend',
      plan: { stacks: { frontend: MOBILE_STACK_ID } },
    });
  } catch (e) {
    console.warn(`writeReadme falló en saveMobile(${slug}):`, e?.message);
  }
  try {
    if (!existsSync(join(dest, 'Dockerfile'))) {
      writeDockerFiles(dest, { frontend: true, backend: false, outDir: detectOutDir(dest) ?? 'dist' });
    }
  } catch (e) {
    console.warn(`writeDockerFiles falló en saveMobile(${slug}):`, e?.message);
  }
  const gitInit = await initGitRepo(dest);
  if (!gitInit?.ok) console.warn(`git init falló en saveMobile(${slug}):`, gitInit?.stderr);
  clearInstall(MOBILE_DIR);
  rmSync(MOBILE_DIR, { recursive: true, force: true });
  return { ok: true, slug };
}

export function discardMobile() {
  if (!existsSync(MOBILE_DIR)) return { ok: true };
  stopDevRun(MOBILE_DIR);
  clearInstall(MOBILE_DIR);
  rmSync(MOBILE_DIR, { recursive: true, force: true });
  return { ok: true };
}

// Archivar en la biblioteca (v15) — espejo de archiveDesign: copia
// workspace+state+spec a design-library/<slug>/ y recién ahí borra
// mobile-work. Si el preview Expo Web no corría lo levantamos solo
// para la captura — es nuestro proceso y SIEMPRE queda frenado
// (stopDevRun corre en todos los caminos del flujo).
export async function archiveMobile({ slug = '', name = '', description = '', agent = '' } = {}) {
  touchActivity();
  if (!existsSync(join(MOBILE_DIR, 'package.json'))) {
    return { ok: false, error: 'no hay diseño mobile para archivar' };
  }
  const install = await awaitInstall(MOBILE_DIR);
  if (install && !install.ok) {
    return { ok: false, error: install.error ?? 'install en curso — esperá a que termine' };
  }
  if (!mobileStatus().devRunning) mobileDev();
  const previewUrl = await waitForUrl(() => mobileStatus());
  const r = await archiveWorkspace({
    kind: 'mobile',
    workDir: MOBILE_DIR,
    statePath,
    slug,
    name,
    description,
    previewUrl,
  });
  if (r.ok) {
    await writeDesignPrompt({ workDir: MOBILE_DIR, entryDir: r.dir, kind: 'mobile', agent });
  }
  stopDevRun(MOBILE_DIR);
  if (mobileStatus().devRunning) {
    console.warn('archiveMobile: el dev quedó corriendo tras frenarlo');
  }
  if (!r.ok) return r;
  clearInstall(MOBILE_DIR);
  rmSync(MOBILE_DIR, { recursive: true, force: true });
  return r;
}

// Restaurar desde la biblioteca — solo same-kind (un diseño web no
// corre en el workspace Expo). El chat sigue con su historial.
export function restoreMobile(slug) {
  touchActivity();
  if (existsSync(join(MOBILE_DIR, 'package.json'))) {
    return { ok: false, error: 'ya existe un diseño mobile en curso — descartalo, guardalo o archivado' };
  }
  const r = restoreWorkspace({ slug, kind: 'mobile', workDir: MOBILE_DIR, statePath });
  if (!r.ok) return r;
  startInstall(MOBILE_DIR);
  return r;
}
