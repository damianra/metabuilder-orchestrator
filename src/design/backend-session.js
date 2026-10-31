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
import { anyBackendManifest, detectBackendStackId } from '../tools/docker.js';
import { copyApiSkeleton, writeAgentsMd } from '../agents/preflight.js';
import { getStack, resolveBackendStackId } from '../stacks/index.js';
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
  if (!anyBackendManifest(dir)) return { exists: false, messages: [] };
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
export function createBackend(framework = 'express', db = 'sqlite', stackId = null) {
  touchActivity();
  if (anyBackendManifest(BACKEND_DIR)) {
    return { ok: false, error: 'ya existe una sesión de backend — descartala o guardala' };
  }
  // Dimensiones sueltas (picker framework × db) o stackId directo
  // (back-compat) — el registry resuelve el stack.
  const id = stackId ?? resolveBackendStackId(framework, db);
  const stack = getStack(id);
  if (stack?.kind !== 'backend') {
    return { ok: false, error: `combo backend inválido "${framework}+${db}${stackId ? ` / stack "${stackId}"` : ''}"` };
  }
  mkdirSync(BACKEND_DIR, { recursive: true });
  copyApiSkeleton(BACKEND_DIR, stack.skeletonDir);
  writeState({
    messages: [],
    created: new Date().toISOString(),
    stackId: stack.id,
    // Con stackId directo (back-compat) los dims vienen por default —
    // persistimos los del def para no guardar metadata engañosa.
    framework: stack.framework ?? framework,
    db: stack.dbs?.includes(db) ? db : (stack.dbs?.[0] ?? db),
  });
  startInstall(BACKEND_DIR, stack.toolchain?.installCmd ?? 'npm install');
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
- \`npm run api\` levanta el server en :4000; \`npm test\` corre vitest; el seed corre solo al arrancar.
- Si el skeleton trae una muestra (\`server/routes/items.js\`), reemplazarla por el recurso real del dominio o eliminarla si no aplica — \`/api/items\` no debe quedar en la app final.`,
  'express-postgres': null,
  'express-mysql': null,
  'express-mongo': `- \`server/routes/<name>.js\` exporta un \`Router\` default → se monta solo en \`/api/<name>\`.
- Document store: \`col(name)\` de \`server/db.js\` (driver \`mongodb\` nativo, \`MONGO_URI\`/\`MONGO_DB\` en \`.env\`); \`seed-data.js\` por colección via \`seedIfEmpty\` — schemaless, NO hay \`schema.sql\`.
- Ids \`ObjectId\` en path params (400 si inválido); sin prepared statements — filtrar con objetos del driver.
- Uploads + security pack ya incluidos. \`npm run api\` :4000; \`npm test\` vitest; la DB viva la aporta el usuario.
- La muestra \`items\` del skeleton: reemplazarla por el recurso real del dominio (rename/refactor completo) o eliminarla si no aplica — \`/api/items\` no debe quedar en la app final.`,
  'nest-typeorm': `- TypeScript + NestJS: recurso nuevo = entity + service + controller + módulo en \`server/\` (registrar el módulo en \`app.module\`).
- Controllers \`*.controller.ts\`: \`@Controller('api/<name>')\` + \`@Get/@Post/@Put/@Delete\` — el api-surface los escanea.
- TypeORM: \`server/database.module.ts\` arma el DataSource por \`DB_TYPE=postgres|mysql|mongodb\` en \`.env\` — agregar entities al array \`entities\`.
- \`npm run api\` = \`build:api\` (tsc → dist-server/) + \`node dist-server/main.js\` en :4000; \`npm test\` vitest (sin DB viva — stubear el repository).
- Sin uploads ni security pack en el skeleton — agregar como middleware/controller propios si hacen falta.
- La muestra \`items\` del skeleton: reemplazarla por el recurso real del dominio (rename/refactor completo) o eliminarla si no aplica — \`/api/items\` no debe quedar en la app final.`,
};
CONVENTIONS['express-postgres'] = CONVENTIONS['express-mysql'] =
  `- \`server/routes/<name>.js\` exporta un \`Router\` default → se monta solo en \`/api/<name>\`.
- DB externa: \`server/db.js\` despacha \`DB_DRIVER=pg|mysql\` (pool + \`q()\` que normaliza \`?\`→\`$n\` + \`insert()\` con id portable) — conexión por \`DB_*\` en \`.env\`; schema DDL por driver en \`SCHEMAS\` (db.js), seed via \`seedIfEmpty\`.
- Prepared statements con \`q()\` SIEMPRE — nunca interpolar valores.
- Uploads + security pack ya incluidos. \`npm run api\` :4000; \`npm test\` vitest; la DB viva la aporta el usuario.
- La muestra \`items\` del skeleton: reemplazarla por el recurso real del dominio (rename/refactor completo) o eliminarla si no aplica — \`/api/items\` no debe quedar en la app final.`;
CONVENTIONS['fastapi'] =
  `- \`app/routers/<name>.py\` exporta \`router\` (APIRouter) → se monta solo en \`/api/<name>\` — agregar un endpoint = agregar un archivo.
- \`app/db.py\` arma engine/session por \`DATABASE_URL\` en .env (sqlite default; postgres/mysql por URL — el driver pip va en requirements.txt).
- \`app/models.py\` las entities SQLAlchemy, \`app/schemas.py\` los Pydantic, \`app/seed.py\` seed idempotente (solo si la tabla está vacía).
- \`.venv/bin/uvicorn app.main:app --port 4000\` levanta la API; \`.venv/bin/python -m pytest\` corre los tests (TestClient + \`DATABASE_URL\` de test). El install crea \`.venv/\` — python/pip/pytest/uvicorn van siempre por \`.venv/bin/<tool>\`.
- Sin uploads ni security pack en el skeleton — middleware/routers propios si hacen falta.
- La muestra \`items\` del skeleton: reemplazarla por el recurso real del dominio (rename/refactor completo) o eliminarla si no aplica — \`/api/items\` no debe quedar en la app final.`;
CONVENTIONS['fastapi-mongo'] =
  `- \`app/routers/<name>.py\` exporta \`router\` (APIRouter) → se monta solo en \`/api/<name>\` — agregar un endpoint = agregar un archivo.
- \`app/db.py\` arma client/engine por \`MONGO_URI\`/\`MONGO_DB\` en .env — ODMantic sobre Motor (async): los Model son pydantic y van directo como \`response_model\`, sin schemas.py.
- \`app/models.py\` los Model ODMantic, \`app/seed.py\` seed idempotente (solo si la colección está vacía).
- \`.venv/bin/uvicorn app.main:app --port 4000\` levanta la API; \`.venv/bin/python -m pytest\` corre los tests (TestClient + mongomock — sin mongo real). El install crea \`.venv/\` — python/pip/pytest/uvicorn van siempre por \`.venv/bin/<tool>\`.
- Endpoints async (\`await engine.find/save/delete\`); ids \`ObjectId\` en path.
- Sin uploads ni security pack en el skeleton — middleware/routers propios si hacen falta.
- La muestra \`items\` del skeleton: reemplazarla por el recurso real del dominio (rename/refactor completo) o eliminarla si no aplica — \`/api/items\` no debe quedar en la app final.`;

export async function backendChat(text, { agent = '', onChunk = () => {}, onActivity = () => {} } = {}) {
  touchActivity();
  if (!anyBackendManifest(BACKEND_DIR)) return { ok: false, error: 'no hay sesión — creala primero' };
  const install = await awaitInstall(BACKEND_DIR);
  if (!install?.ok) return { ok: false, error: `install falló: ${install?.stderr?.slice(-200) ?? ''}` };
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
  if (!anyBackendManifest(BACKEND_DIR)) {
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
  // Entornos/cachés python del workspace: un .venv copiado queda roto
  // (shebangs/symlinks con path absoluto del origen) — el install en
  // dest lo recrea. Las caches son recreables y no aportan.
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
]);
// Dbs de prueba del dev-run y bytecode suelto — no van a la app.
const SAVE_SKIP = (src) => src.endsWith('.sqlite') || src.endsWith('.db') || src.endsWith('.pyc');

export async function saveBackend(slug) {
  if (!anyBackendManifest(BACKEND_DIR)) return { ok: false, error: 'no hay sesión para guardar' };
  const dest = join(config.generatedAppsDir, slug);
  if (existsSync(dest)) return { ok: false, error: `ya existe ${slug}` };
  stopDevRun(BACKEND_DIR);
  mkdirSync(config.generatedAppsDir, { recursive: true });
  cpSync(BACKEND_DIR, dest, {
    recursive: true,
    filter: (src) => !SAVE_EXCLUDE.has(basename(src)) && !SAVE_SKIP(src),
  });
  rmSync(statePath, { force: true });
  const savedStack = getStack(detectBackendStackId(BACKEND_DIR)) ?? getStack('express-sqlite');
  // Deps fuera del copy (node_modules/.venv) → install propio en el
  // destino con el toolchain del stack, igual que saveDesign. Falla →
  // se borra dest y el workspace queda intacto para reintentar.
  clearInstall(dest);
  startInstall(dest, savedStack.toolchain?.installCmd ?? 'npm install');
  const install = await awaitInstall(dest);
  if (!install?.ok) {
    rmSync(dest, { recursive: true, force: true }); // no dejar slug ocupado
    return { ok: false, error: `install en ${slug} falló: ${install?.stderr?.slice(-200) ?? ''}` };
  }
  writeFileSync(
    join(dest, 'plan.json'),
    JSON.stringify(
      {
        projectName: slug,
        scope: 'backend',
        appType: 'custom',
        arch: 'flat',
        idea: 'api creada en la pestaña Backend (chat experto)',
        stacks: { backend: savedStack.id },
        validated: true,
        steps: [
          {
            id: 1,
            type: 'backend',
            description:
              `API implementada iterando en chat de backend — ${savedStack.label} sobre su skeleton con arquitectura flat`,
            verify: savedStack.toolchain?.testCmd ?? 'npm test',
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
  // El rename aplica solo si el toolchain del stack usa package.json.
  try {
    const pkgPath = join(dest, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.name = slug;
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  } catch {
    /* manifest ilegible — el guardado sigue siendo válido */
  }
  // writeAgentsMd(dir, {withBackend, arch, frontendStack}) — envuelto
  // en try: AGENTS.md es nice-to-have, no debe dejar estado
  // inconsistente (dest creado + workspace intacto → retry 409).
  try {
    const savedPlan = JSON.parse(readFileSync(join(dest, 'plan.json'), 'utf8'));
    writeAgentsMd(dest, {
      withBackend: true,
      withFrontend: false,
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
