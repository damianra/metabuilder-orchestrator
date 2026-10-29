import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { complianceFor, complianceOverlayDirs } from '../compliance/index.js';
import { basename, dirname, join } from 'node:path';

// Copia solo los archivos del overlay que falten en el proyecto —
// idempotente y seguro en resume: nunca pisa archivos que el builder
// ya pudo haber personalizado.
const copyOverlayMissing = (odir, dir) => {
  for (const entry of readdirSync(odir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const rel = join(entry.parentPath ?? entry.path, entry.name).slice(odir.length + 1);
    const dest = join(dir, rel);
    if (!existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(odir, rel), dest);
    }
  }
};
import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { checkEngineAuth } from '../tools/acp.js';
import { getEngine, resolveEngineAuto, resolveEngineId } from '../engines/index.js';
import { startInstall } from '../tools/install.js';
import { ensureProjectDir } from '../tools/slug.js';
import { writeDockerFiles, detectFrontend, detectStackId, detectOutDir, hasBackendDir, anyManifest, installCommands } from '../tools/docker.js';
import { resolveArch, resolveArchSafe } from '../arch/index.js';
import { resolveStacks, resolveStacksSafe } from '../stacks/index.js';
import { getVertical } from '../verticals/index.js';
import { activity, log, readPlan } from './common.js';

const BASE_BINS = ['node', 'npm', 'git'];

/**
 * Copia src/templates/<skeletonDir>/ sobre el proyecto:
 * - package.partial.json → se mergea en package.json existente
 *   (fullstack) o se convierte en el package.json (backend puro).
 * - gitignore.partial → se appendea al .gitignore existente o lo crea.
 * Ambos partials son opcionales — un skeleton no-Node (requirements.txt)
 * no trae ninguno y la copia igual aplica.
 * `skeletonDir` viene del stack backend activo (src/stacks/).
 */
export function copyApiSkeleton(dir, skeletonDir = 'api-skeleton') {
  const src = join(config.templatesDir, skeletonDir);
  cpSync(src, dir, {
    recursive: true,
    filter: (s) => !['package.partial.json', 'gitignore.partial'].includes(basename(s)),
  });

  const partialPath = join(src, 'package.partial.json');
  if (existsSync(partialPath)) {
    const partial = JSON.parse(readFileSync(partialPath, 'utf8'));
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.scripts = { ...partial.scripts, ...pkg.scripts };
      pkg.dependencies = { ...partial.dependencies, ...pkg.dependencies };
      pkg.devDependencies = { ...partial.devDependencies, ...pkg.devDependencies };
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    } else {
      writeFileSync(pkgPath, JSON.stringify(partial, null, 2) + '\n');
    }
  }

  const giPartial = join(src, 'gitignore.partial');
  if (existsSync(giPartial)) {
    const gi = readFileSync(giPartial, 'utf8');
    const giPath = join(dir, '.gitignore');
    writeFileSync(giPath, existsSync(giPath) ? readFileSync(giPath, 'utf8').trimEnd() + '\n' + gi : gi);
  }
}

/**
 * Chromium se descarga una vez en ~/.cache/ms-playwright (compartido
 * entre apps). Lo pre-calentamos en background, encadenado al
 * npm install que provee el binario playwright. Nunca se awaita:
 * el paso e2e reintenta `npx playwright install chromium` si hiciera
 * falta.
 */
function prewarmPlaywright(dir, installCmd = 'npm install') {
  startInstall(dir, installCmd)
    .then((r) => r.ok && run('npx playwright install chromium', { cwd: dir, timeoutMs: 600_000 }))
    .catch(() => {});
}

/**
 * AGENTS.md de la app generada: template base (con {{frontendStack}}
 * = agentsStack del stack activo) + sección de arquitectura backend
 * (src/arch/) cuando el scope tiene backend.
 * Es lo que el builder/fixer/reviewer leen como contrato del código.
 */
// Líneas de comandos del AGENTS.md por toolchain del stack — el
// contrato para el agente nunca menciona npm en un stack no-Node.
const scriptLines = (s) => {
  const t = s?.toolchain;
  if (!t) return [];
  const lines = [];
  if (t.buildCmd) lines.push(`- \`${t.buildCmd}\` — build de producción`);
  if (t.devCmd) {
    lines.push(`- \`${t.devCmd}\` — ${s.kind === 'backend' ? `API en puerto ${t.devPort ?? 4000}` : `dev server en puerto ${t.devPort ?? 5173}`}`);
  }
  if (t.devCmd === 'npm run api') lines.push('- `npm run dev:api` — lo mismo con `--watch`');
  if (t.testCmd) lines.push(`- \`${t.testCmd}\` — suite ${t.testLabel ?? 'Vitest'}`);
  if (t.e2eCmd) lines.push(`- \`${t.e2eCmd}\` — suite e2e`);
  return lines;
};

export function writeAgentsMd(dir, { withBackend, arch, frontendStack, backendStack }) {
  const testLabels = [
    ...new Set(
      [frontendStack, backendStack].filter(Boolean).map((s) => s.toolchain?.testLabel ?? 'Vitest'),
    ),
  ];
  const devScripts = [
    ...new Set([...scriptLines(frontendStack), ...scriptLines(backendStack)]),
  ].join('\n');
  const base = readFileSync(join(config.templatesDir, 'AGENTS.md'), 'utf8')
    .replaceAll('{{frontendStack}}', frontendStack?.agentsStack ?? 'React + Vite + Tailwind CSS')
    .replaceAll('{{backendFramework}}', backendStack?.agentsStack ?? 'Node.js + Express')
    .replaceAll('{{backendDb}}', backendStack?.agentsDb ?? 'SQLite (archivo local, sin servidores externos)')
    .replaceAll('{{testing}}', testLabels.join(' + '))
    .replaceAll('{{devScripts}}', devScripts);
  const rules = withBackend ? `\n## Arquitectura backend\n\n${arch.agentsRules}\n` : '';
  writeFileSync(join(dir, 'AGENTS.md'), base + rules);
}

export async function preflightNode(state) {
  const history = [log('preflight', 'verificando binarios y autenticación')];
  const arch = resolveArch(state.arch);

  // Engine de agente: --agent > plan.agent (resume) > settings.json >
  // AGENT_PROVIDER > 'auto' (devin si autentica, sino opencode). Un id
  // desconocido es fail temprano — mejor acá que en el primer prompt.
  let savedPlan = null;
  if (state.resumeDir) {
    try {
      savedPlan = readPlan(state.resumeDir);
    } catch {
      /* plan.json ilegible → cae a flags/settings */
    }
  }
  const engineId = resolveEngineId({ flag: state.agent, plan: savedPlan?.agent });
  let engine;
  let auth;
  if (engineId === 'auto') {
    engine = await resolveEngineAuto((id) => checkEngineAuth(id, 15_000));
    if (!engine) {
      return {
        status: 'failed',
        lastError:
          'ningún engine de agente autentica (probados: devin, opencode) — ' +
          '`devin auth login` o `opencode auth login`',
        history: [...history, log('preflight', 'auto: ningún engine autentica')],
      };
    }
    auth = { ok: true }; // la sonda auto ya lo verificó
    history.push(log('preflight', `motor de agente: ${engine.label} (auto)`));
  } else {
    engine = getEngine(engineId);
    if (!engine) {
      return {
        status: 'failed',
        lastError: `engine desconocido "${engineId}"`,
        history: [...history, log('preflight', `engine inválido: ${engineId}`)],
      };
    }
    history.push(log('preflight', `motor de agente: ${engine.label} (${engine.id})`));
  }

  // Probes: binarios requeridos (+ auth del engine si no vino del auto).
  const requiredBins = [...BASE_BINS, engine.bin];
  const [bins, authResult] = await Promise.all([
    Promise.all(requiredBins.map((bin) => run(`command -v ${bin}`))),
    auth ?? checkEngineAuth(engine.id),
  ]);
  auth = authResult;
  const missing = requiredBins.filter((_, i) => !bins[i].ok);
  if (missing.length) {
    return {
      status: 'failed',
      lastError: `binario requerido no encontrado: ${missing.join(', ')}`,
      history: [...history, log('preflight', `falta ${missing.join(', ')}`)],
    };
  }
  if (!auth.ok) {
    return {
      status: 'failed',
      lastError: `${engine.label} no autentica vía ACP: ${auth.error}`,
      history: [...history, log('preflight', `auth falló: ${auth.error}`)],
    };
  }

  // --resume: el directorio ya existe con plan.json — no se crea ni
  // se copia nada; se re-lanza el install del toolchain (idempotente)
  // por si las deps quedaron a medias o borradas.
  if (state.resumeDir) {
    const dir = state.resumeDir;
    const slug = basename(dir);
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}-resume`;
    const runDir = join(config.runsDir, runId);
    mkdirSync(join(runDir, 'prompts'), { recursive: true });

    // El arch/stacks reales viven en plan.json (state.arch/state.stack*
    // son solo los flags — planner los restaura recién después).
    let planArch, planStacks;
    try {
      const saved = readPlan(dir);
      planArch = saved?.arch;
      planStacks = saved?.stacks;
    } catch {
      /* plan.json ilegible: cae a los flags */
    }
    const resumeStacks = resolveStacksSafe(state.scope, {
      frontend:
        planStacks?.frontend ??
        state.stackFrontend ??
        detectStackId(dir) ?? undefined,
      backend: planStacks?.backend ?? state.stackBackend ?? undefined,
    });
    // --extend: el proyecto es frontend-only → el api-skeleton entra
    // ANTES de writeAgentsMd/writeDockerFiles para que la detección de
    // server/ ya vea el backend (mergea package.json, nunca pisa).
    if (state.extend && !hasBackendDir(dir)) {
      copyApiSkeleton(dir, resumeStacks.backend?.skeletonDir ?? 'api-skeleton');
      history.push(log('preflight', 'api-skeleton copiado (extend → fullstack)'));
      activity('api-skeleton copiado');
    }
    writeAgentsMd(dir, {
      withBackend: hasBackendDir(dir),
      arch: resolveArchSafe(planArch, state.arch),
      frontendStack: resumeStacks.frontend,
      backendStack: resumeStacks.backend,
    });
    // Dockerfile determinístico según lo que ya tiene el dir
    // (apps pre-docker lo reciben al resumir).
    const dockerVariant = writeDockerFiles(dir, {
      frontend: detectFrontend(dir),
      backend: hasBackendDir(dir),
      backendStackId: resumeStacks.backend?.id,
      outDir: detectOutDir(dir),
    });
    history.push(log('preflight', `Dockerfile escrito (${dockerVariant})`));
    // Overlays de compliance en resume también: apps pre-v7 o resume
    // con --compliance nuevo reciben los componentes que falten (nunca
    // se pisa un archivo existente — el builder pudo personalizarlo).
    if (anyManifest(dir, resumeStacks) && (savedPlan?.scope ?? state.scope) !== 'backend') {
      const ids = complianceFor({
        idea: savedPlan?.idea ?? state.idea,
        scope: savedPlan?.scope ?? state.scope,
        flag: state.compliance,
        plan: savedPlan,
      });
      for (const rel of complianceOverlayDirs(ids)) {
        const odir = join(config.rootDir, 'src', 'compliance', rel);
        if (existsSync(odir)) copyOverlayMissing(odir, dir);
      }
    }
    for (const cmd of installCommands(dir, resumeStacks)) {
      startInstall(dir, cmd);
      history.push(log('preflight', `${cmd} corriendo en background (resume)`));
    }

    return {
      projectSlug: slug,
      projectDir: dir,
      runDir,
      agent: engine.id,
      status: 'preflighted',
      history: [...history, log('preflight', `reanudando proyecto: ${dir}`)],
    };
  }

  const name = state.projectSlug || state.idea || 'app';
  const { slug, dir } = ensureProjectDir(config.generatedAppsDir, name);

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}`;
  const runDir = join(config.runsDir, runId);
  mkdirSync(join(runDir, 'prompts'), { recursive: true });

  const stacks = resolveStacks(state.scope, {
    frontend: state.stackFrontend ?? undefined,
    backend: state.stackBackend ?? undefined,
  });
  writeAgentsMd(dir, {
    withBackend: state.scope !== 'frontend',
    arch,
    frontendStack: stacks.frontend,
    backendStack: stacks.backend,
  });
  const dockerVariant = writeDockerFiles(dir, {
    frontend: state.scope !== 'backend',
    backend: state.scope !== 'frontend',
    backendStackId: stacks.backend?.id,
    outDir: stacks.frontend?.buildDir ?? 'dist',
  });
  history.push(log('preflight', `Dockerfile escrito (${dockerVariant})`));

  // Vertical conocido con frontend → copiar el skeleton del stack
  // frontend activo. Scope con backend → skeleton del stack backend;
  // el overlay del vertical aporta schema/seed/routes si existe.
  // (scaffold determinístico: el agente no gasta tiempo ni tokens en init).
  const vertical = getVertical(state.appType);
  const withFrontend = state.scope !== 'backend';
  const withBackend = state.scope !== 'frontend';
  // "fresh" = no hay manifest de ningún stack activo — una app sin
  // package.json pero con requirements.txt (toolchain python) tampoco
  // es fresh.
  const fresh = !anyManifest(dir, stacks);

  if (fresh) {
    if (vertical && withFrontend) {
      cpSync(join(config.templatesDir, stacks.frontend.skeletonDir), dir, { recursive: true });
      history.push(log('preflight', `skeleton frontend copiado (${vertical.name})`));
      activity('skeleton frontend copiado');
    }

    const overlayDir = vertical
      ? join(config.rootDir, 'src', 'verticals', vertical.name, 'api')
      : null;
    const wantsApi =
      withBackend && (state.appType === 'custom' || (overlayDir && existsSync(overlayDir)));
    if (wantsApi) {
      copyApiSkeleton(dir, stacks.backend.skeletonDir);
      history.push(log('preflight', `api-skeleton copiado (${stacks.backend.label})`));
      activity('api-skeleton copiado');
      if (overlayDir && existsSync(overlayDir)) {
        cpSync(overlayDir, join(dir, 'server'), { recursive: true });
        history.push(log('preflight', `overlay api de ${vertical.name} aplicado`));
        activity('overlay api del vertical aplicado');
      }
    }

    // Overlays de compliance: componentes listos por perfil activo
    // (p.ej. CookieBanner.jsx) — la resolución repite la de planner
    // (idea+scope+flag) para que los archivos estén antes del builder.
    if (withFrontend) {
      const ids = complianceFor({
        idea: state.idea,
        scope: state.scope,
        flag: state.compliance,
      });
      for (const rel of complianceOverlayDirs(ids)) {
        const odir = join(config.rootDir, 'src', 'compliance', rel);
        if (existsSync(odir)) {
          cpSync(odir, dir, { recursive: true });
          history.push(log('preflight', `overlay compliance "${rel.split('/')[1]}" copiado`));
        }
      }
    }

    // Personalizar placeholders del skeleton (los de Next: app/).
    for (const f of ['package.json', 'index.html', 'src/App.jsx', 'src/app/page.jsx', 'src/app/layout.jsx']) {
      const p = join(dir, f);
      if (existsSync(p)) {
        writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__APP_NAME__', slug));
      }
    }

    // Install lazy: corre en background mientras el pipeline avanza
    // (planner, confirmación del plan). Los comandos salen del
    // toolchain de cada stack activo (npm install para los de hoy);
    // builder/verifier los awaitan antes de tocar las deps.
    const installCmds = installCommands(dir, stacks);
    if (installCmds.length) {
      for (const cmd of installCmds) startInstall(dir, cmd);
      history.push(log('preflight', `${installCmds.join(' + ')} corriendo en background`));
      activity('install de dependencias en background…');
      if (vertical && withFrontend) {
        prewarmPlaywright(dir, stacks.frontend?.toolchain?.installCmd);
        history.push(log('preflight', 'playwright chromium pre-warm en background'));
      }
    }
  }

  return {
    projectSlug: slug,
    projectDir: dir,
    runDir,
    agent: engine.id,
    status: 'preflighted',
    history: [...history, log('preflight', `proyecto: ${dir}`)],
  };
}
