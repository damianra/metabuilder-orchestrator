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
import { apiSurfaceFor, apiSurfaceKindOf } from '../tools/api-surface.js';
import { detectBackendStackId } from '../tools/docker.js';
import { copyApiSkeleton, writeAgentsMd } from '../agents/preflight.js';
import { getStack } from '../stacks/index.js';
import { resolveArchSafe } from '../arch/index.js';

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
  return { exists: true, ...readState(join(dir, 'backend-state.json')), apiRunning,
    apiSurface: apiSurfaceFor(dir, { kind: apiSurfaceKindOf(detectBackendStackId(dir)) }),
  };
}

// Crea el workspace copiando el api-skeleton — reuse de
// copyApiSkeleton (preflight): promueve package.partial.json →
// package.json y gitignore.partial → .gitignore (sin esto el publish
// de la app guardada commitearía .env/*.sqlite/node_modules).
export function createBackend(stackId = 'express-sqlite') {
  touchActivity();
  if (existsSync(join(BACKEND_DIR, 'package.json'))) {
    return { ok: false, error: 'ya existe una sesión de backend — descartala o guardala' };
  }
  const stack = getStack(stackId);
  if (stack?.kind !== 'backend') {
    return { ok: false, error: `stack backend inválido "${stackId}"` };
  }
  mkdirSync(BACKEND_DIR, { recursive: true });
  copyApiSkeleton(BACKEND_DIR, stack.skeletonDir);
  writeState({ messages: [], created: new Date().toISOString(), stackId: stack.id });
  startInstall(BACKEND_DIR);
  return { ok: true };
}

// Convenciones "NO las rompas" del prompt del experto — por stack
// elegido (el .md lleva `{{stackConventions}}` — no hardcodear sqlite
// como antes, que contradecía a mongo/pg/mysql/nest).
const CONVENTIONS = {
  'express-sqlite': `- \`server/routes/<name>.js\` exporta un \`Router\` default → se monta solo en \`/api/<name>\` — agregar un endpoint = agregar un archivo.
- \`server/schema.sql\` es el schema (idempotente, corre al arrancar); \`server/seed-data.js\` siembra solo si la tabla está vacía.
- DB: \`better-sqlite3\` con prepared statements SIEMPRE — nunca interpolar valores en queries.
- Security pack ya incluido (headers, rate limit, request logger) — no duplicar.
- Uploads: \`POST /api/uploads\` (campo \`file\`) → \`{url:"/uploads/<f>"}\`.
- \`npm run api\` levanta el server en :4000; \`npm test\` corre vitest; el seed corre solo al arrancar.`,
  'express-postgres': null,
  'express-mysql': null,
  'express-mongo': `- \`server/routes/<name>.js\` exporta un \`Router\` default → se monta solo en \`/api/<name>\`.
- Document store: \`col(name)\` de \`server/db.js\` (driver \`mongodb\` nativo, \`MONGO_URI\`/\`MONGO_DB\` en \`.env\`); \`seed-data.js\` por colección via \`seedIfEmpty\` — schemaless, NO hay \`schema.sql\`.
- Ids \`ObjectId\` en path params (400 si inválido); sin prepared statements — filtrar con objetos del driver.
- Uploads + security pack ya incluidos. \`npm run api\` :4000; \`npm test\` vitest; la DB viva la aporta el usuario.`,
  'nest-typeorm': `- TypeScript + NestJS: recurso nuevo = entity + service + controller + módulo en \`src/\` (registrar el módulo en \`app.module\`).
- Controllers \`*.controller.ts\`: \`@Controller('api/<name>')\` + \`@Get/@Post/@Put/@Delete\` — el api-surface los escanea.
- TypeORM: \`src/database.module.ts\` arma el DataSource por \`DB_TYPE=postgres|mysql\` en \`.env\` — agregar entities al array \`entities\`.
- \`npm run api\` = \`tsc\` + \`node dist/main.js\` en :4000; \`npm test\` vitest (sin DB viva — stubear el repository).
- Sin uploads ni security pack en el skeleton — agregar como middleware/controller propios si hacen falta.`,
};
CONVENTIONS['express-postgres'] = CONVENTIONS['express-mysql'] =
  `- \`server/routes/<name>.js\` exporta un \`Router\` default → se monta solo en \`/api/<name>\`.
- DB externa: \`server/db.js\` despacha \`DB_DRIVER=pg|mysql\` (pool + \`q()\` que normaliza \`?\`→\`$n\` + \`insert()\` con id portable) — conexión por \`DB_*\` en \`.env\`; schema DDL por driver en \`SCHEMAS\` (db.js), seed via \`seedIfEmpty\`.
- Prepared statements con \`q()\` SIEMPRE — nunca interpolar valores.
- Uploads + security pack ya incluidos. \`npm run api\` :4000; \`npm test\` vitest; la DB viva la aporta el usuario.`;

export async function backendChat(text, { agent = '', onChunk = () => {}, onActivity = () => {} } = {}) {
  touchActivity();
  if (!existsSync(join(BACKEND_DIR, 'package.json'))) return { ok: false, error: 'no hay sesión — creala primero' };
  const install = await awaitInstall(BACKEND_DIR);
  if (!install?.ok) return { ok: false, error: `npm install falló: ${install?.stderr?.slice(-200) ?? ''}` };
  const state = readState();
  const history = state.messages
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Experto'}: ${m.text}`)
    .join('\n');
  const st = getStack(state.stackId ?? 'express-sqlite');
  const prompt =
    loadPrompt('backend-designer', {
      backendFramework: st?.agentsStack ?? 'Node.js + Express',
      stackConventions: CONVENTIONS[st?.id ?? 'express-sqlite'],
    }) +
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
const SAVE_EXCLUDE = new Set([
  'node_modules',
  'backend-state.json',
  'dev-run.json',
  'dev-run.log',
  '.env', // secrets del workspace nunca van a la app guardada
]);
const SAVE_SKIP = (src) => src.endsWith('.sqlite'); // dbs de prueba del dev-run

export function saveBackend(slug) {
  if (!existsSync(join(BACKEND_DIR, 'package.json'))) return { ok: false, error: 'no hay sesión para guardar' };
  const dest = join(config.generatedAppsDir, slug);
  if (existsSync(dest)) return { ok: false, error: `ya existe ${slug}` };
  stopDevRun(BACKEND_DIR);
  mkdirSync(config.generatedAppsDir, { recursive: true });
  cpSync(BACKEND_DIR, dest, {
    recursive: true,
    filter: (src) => !SAVE_EXCLUDE.has(basename(src)) && !SAVE_SKIP(src),
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
        stacks: { backend: detectBackendStackId(BACKEND_DIR) ?? 'express-sqlite' },
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
  // writeAgentsMd(dir, {withBackend, arch, frontendStack}) — envuelto
  // en try: AGENTS.md es nice-to-have, no debe dejar estado
  // inconsistente (dest creado + workspace intacto → retry 409).
  try {
    const savedPlan = JSON.parse(readFileSync(join(dest, 'plan.json'), 'utf8'));
    writeAgentsMd(dest, {
      withBackend: true,
      arch: resolveArchSafe(savedPlan.arch, 'flat'),
      frontendStack: undefined,
      backendStack: getStack(savedPlan.stacks?.backend ?? detectBackendStackId(dest)),
    });
  } catch {
    /* AGENTS.md falló — el guardado sigue siendo válido */
  }
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
