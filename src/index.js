import { Command } from '@langchain/langgraph';
import { createInterface } from 'node:readline/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraph } from './orchestrator/graph.js';
import { listArchs } from './arch/index.js';
import { resolveCompliance } from './compliance/index.js';
import { getStack, listStacks } from './stacks/index.js';
import { getVertical, inferAppType, listVerticals } from './verticals/index.js';
import { resolveResumeDir } from './tools/slug.js';
import { getEngine, listEngines } from './engines/index.js';
import { config } from './config.js';
import { readPlan, setQuiet } from './agents/common.js';

function parseArgs(argv) {
  const args = { noPush: false, keepGoing: false, yes: false, github: false, ghpages: false, quiet: false, verbose: false, verifyDocker: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-push') args.noPush = true;
    else if (a === '--keep-going') args.keepGoing = true;
    else if (a === '--github') args.github = true;
    else if (a === '--ghpages') args.ghpages = true;
    else if (a === '--verify-docker') args.verifyDocker = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i];
    }
  }
  return args;
}

function printPlan(plan) {
  const arch = plan.arch ? `, arch ${plan.arch}` : '';
  console.log(`\n=== Plan: ${plan.projectName} (${plan.appType}, scope ${plan.scope}${arch}) ===`);
  for (const s of plan.steps) {
    const status = s.status && s.status !== 'pending' ? ` [${s.status}]` : '';
    console.log(`  ${s.id}. [${s.type}]${status} ${s.description.slice(0, 110)}${s.description.length > 110 ? '…' : ''}`);
    console.log(`     verify: ${s.verify}`);
  }
}

function createAsker() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: async (q) => (await rl.question(q)).trim(),
    close: () => rl.close(),
  };
}

// Modo interactivo: rellena lo que falten los flags.
async function collectArgs(args) {
  // --yes = cero preguntas: todo lo opcional toma su default (idea
  // sigue siendo obligatoria — sin ella se sale con código 2).
  const interactive = Boolean(process.stdin.isTTY) && !args.yes;
  const asker = createAsker();
  try {
    // --resume/--extend: idea/scope/appType/name/phone salen del
    // plan.json — solo se preguntan las decisiones de deploy. --yes
    // también las salta: un run encolado (dashboard/queue) heredaría
    // el TTY del worker y se colgaría esperando input que nadie ve.
    if (args.resume || args.extend) {
      if (!args.github && !args.noPush && interactive && !args.yes) {
        const g = await asker.ask('¿Crear repo en GitHub? [s/N] ');
        args.github = /^s/i.test(g);
        if (!args.github) args.noPush = true;
      }
      if (args.github && !args.ghpages && interactive && !args.yes) {
        const p = await asker.ask('¿Publicar en GitHub Pages? [s/N] ');
        args.ghpages = /^s/i.test(p);
      }
      return args;
    }
    if (!args.idea) {
      if (!interactive) {
        console.error('Falta --idea "<descripcion>"');
        process.exit(2);
      }
      args.idea = await asker.ask('¿Qué aplicación querés crear? ');
    }
    if (!args.scope) {
      if (!interactive) args.scope = 'fullstack';
      else {
        const s = await asker.ask('Scope [fullstack/frontend/backend] (fullstack): ');
        args.scope = ['frontend', 'backend', 'fullstack'].includes(s) ? s : 'fullstack';
      }
    }
    if (!args.appType) {
      const inferred = inferAppType(args.idea, args.scope);
      if (!interactive) args.appType = inferred;
      else {
        const t = await asker.ask(
          `Tipo de app [${[...listVerticals(), 'custom'].join('/')}] (${inferred}): `,
        );
        args.appType = t || inferred;
      }
    }
    if (!args.arch && args.scope !== 'frontend' && interactive) {
      const a = await asker.ask(`Arquitectura backend [${listArchs().join('/')}] (flat): `);
      args.arch = listArchs().includes(a) ? a : 'flat';
    }
    if (!args.stackFrontend && args.scope !== 'backend' && interactive) {
      const ids = listStacks('frontend').map((s) => s.id);
      const s = await asker.ask(`Stack frontend [${ids.join('/')}] (${ids[0]}): `);
      args.stackFrontend = ids.includes(s) ? s : ids[0];
    }
    if (!args.name && interactive) {
      args.name = await asker.ask('Nombre del proyecto (slug, vacío = derivar de la idea): ');
    }
    if (!args.phone && interactive) {
      args.phone = await asker.ask('WhatsApp del negocio (ej. 5491155500000, vacío = sin WhatsApp/contacto): ');
    }
    if (!args.github && !args.noPush && interactive && !args.yes) {
      const g = await asker.ask('¿Crear repo en GitHub? [s/N] ');
      args.github = /^s/i.test(g);
      if (!args.github) args.noPush = true;
    }
    if (args.github && !args.ghpages && interactive && !args.yes && args.scope !== 'backend') {
      const p = await asker.ask('¿Publicar en GitHub Pages? [s/N] ');
      args.ghpages = /^s/i.test(p);
    }
  } finally {
    asker.close();
  }
  return args;
}

const args = await collectArgs(parseArgs(process.argv.slice(2)));

// --resume <dir|slug>: reanuda un run desde su plan.json. Acepta una
// ruta o el nombre dentro de generated-apps/. No requiere --idea.
let resumeDir = '';
if (args.resume) {
  resumeDir = resolveResumeDir(args.resume, config.generatedAppsDir);
  if (!resumeDir) {
    console.error(
      `--resume: no se encontró "${args.resume}" con plan.json ` +
        `(probado como ruta y como slug en ${config.generatedAppsDir})`,
    );
    process.exit(2);
  }
}

// --extend <dir|slug>: mismo resolve que --resume, pero el pipeline
// appendea pasos backend al plan (proyecto frontend → fullstack).
if (args.extend) {
  if (args.resume) {
    console.error('--extend y --resume son excluyentes');
    process.exit(2);
  }
  resumeDir = resolveResumeDir(args.extend, config.generatedAppsDir);
  if (!resumeDir) {
    console.error(
      `--extend: no se encontró "${args.extend}" con plan.json ` +
        `(probado como ruta y como slug en ${config.generatedAppsDir})`,
    );
    process.exit(2);
  }
  if (existsSync(join(resumeDir, 'server'))) {
    console.error(`--extend: ${resumeDir} ya tiene backend (server/) — nada que extender`);
    process.exit(2);
  }
}

// Deploy en resume: plan.deploy es "lo ingresado previamente" — manda
// salvo flags explícitos (--github/--no-push, o lo que respondió el
// usuario en las preguntas de collectArgs).
if (resumeDir && !args.github && !args.noPush) {
  let saved = null;
  try {
    saved = readPlan(resumeDir);
  } catch (e) {
    console.error(`--resume: plan.json inválido en ${resumeDir}: ${e.message}`);
    process.exit(2);
  }
  if (saved?.deploy) {
    args.github = Boolean(saved.deploy.github);
    args.ghpages = args.ghpages || (Boolean(saved.deploy.pages) && args.github);
    args.noPush = !args.github;
  }
}

if (!args.idea && !resumeDir) {
  console.error('Falta --idea "<descripcion>"');
  process.exit(2);
}
if (!resumeDir && !getVertical(args.appType) && args.appType !== 'custom') {
  console.error(`--app-type desconocido "${args.appType}" (usá ${listVerticals().join('|')} o custom)`);
  process.exit(2);
}
if (args.arch && !listArchs().includes(args.arch)) {
  console.error(`--arch desconocida "${args.arch}" (usá ${listArchs().join('|')})`);
  process.exit(2);
}
for (const [flag, kind] of [
  ['--stack-frontend', 'frontend'],
  ['--stack-backend', 'backend'],
]) {
  const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (args[key] && getStack(args[key])?.kind !== kind) {
    console.error(
      `${flag} desconocido "${args[key]}" (usá ${listStacks(kind).map((s) => s.id).join('|')})`,
    );
    process.exit(2);
  }
}
if (args.agent && args.agent !== 'auto' && !getEngine(args.agent)) {
  console.error(`--agent desconocido "${args.agent}" (usá ${listEngines().join('|')}|auto)`);
  process.exit(2);
}
if (args.compliance) {
  try {
    // Suma perfiles explícitos a los base/inferidos — el flag es
    // aditivo, nunca saca los que la app necesita.
    resolveCompliance({ idea: args.idea ?? '', scope: args.scope ?? 'fullstack', flag: args.compliance });
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
if (args.ghpages && !args.github) {
  console.error('--ghpages requiere --github (crea el repo antes de publicar Pages)');
  process.exit(2);
}

// Confirmación de plan: solo si la salida es interactiva y no se pasó --yes.
const confirmPlan = Boolean(process.stdin.isTTY) && !args.yes;

const initial = {
  idea: args.idea ?? '',
  scope: args.scope ?? 'fullstack',
  appType: args.appType ?? 'custom',
  arch: args.arch ?? 'flat',
  resumeDir,
  extend: Boolean(args.extend),
  projectSlug: args.name ?? '',
  noPush: args.noPush,
  keepGoing: args.keepGoing,
  confirmPlan,
  deployGithub: args.github,
  deployPages: args.ghpages,
  whatsappPhone: args.phone ?? '',
  verifyDocker: Boolean(args.verifyDocker),
  stackFrontend: args.stackFrontend ?? null,
  stackBackend: args.stackBackend ?? null,
  compliance: args.compliance ?? null,
  agent: args.agent ?? '',
};

// Etiqueta legible por nodo (rol del agente que está corriendo).
const NODE_LABEL = {
  preflight: '⚙  preflight',
  planner: '📋 planner',
  validate: '✔  validate',
  repairPlan: '📋 repair-plan',
  confirm: '🖐  confirm',
  build: '🛠  dev',
  verify: '🔍 verify',
  fix: '🔧 fix',
  finalVerify: '🔍 final-verify',
  review: '🧐 QA',
  finalize: '📦 finalize',
  fail: '✗  fail',
};

setQuiet(args.quiet);
const MAX_MSG = args.verbose ? Infinity : 220;
const trim = (s) => (s.length > MAX_MSG ? s.slice(0, MAX_MSG) + '…' : s);

// Escribe status.json dentro del proyecto (punto 4: estado para
// workers/CI sin depender de la terminal). elapsedMs mide desde el
// inicio de la ejecución del grafo (no incluye las preguntas del CLI).
const startedAt = Date.now();
let snapshot = { ...initial };
function writeStatus(node) {
  if (!snapshot.projectDir) return;
  try {
    const total = snapshot.plan?.steps?.length ?? 0;
    writeFileSync(
      join(snapshot.projectDir, 'status.json'),
      JSON.stringify(
        {
          node,
          status: snapshot.status,
          step: Math.min(snapshot.currentStepIndex ?? 0, total),
          totalSteps: total,
          lastError: snapshot.lastError ?? null,
          elapsedMs: Date.now() - startedAt,
          ts: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  } catch {
    /* status.json nunca debe romper el pipeline */
  }
}

function reportUpdate(node, update) {
  for (const [k, v] of Object.entries(update ?? {})) {
    if (v !== undefined) snapshot[k] = v;
  }
  writeStatus(node);
  if (args.quiet) return;
  const label = NODE_LABEL[node] ?? node;
  const msgs = update?.history?.length ? update.history : [{ msg: JSON.stringify(update).slice(0, 120) }];
  for (const h of msgs) {
    const stepInfo =
      node === 'build' && snapshot.plan
        ? ` [paso ${Math.min((snapshot.currentStepIndex ?? 0) + 1, snapshot.plan.steps.length)}/${snapshot.plan.steps.length}]`
        : '';
    console.log(`${label}${stepInfo}  ${trim(h.msg)}`);
  }
}

const app = buildGraph();
const runConfig = { configurable: { thread_id: `run-${Date.now()}` } };

if (!args.quiet) {
  const deploy = args.github ? (args.ghpages ? 'GitHub + Pages' : 'GitHub') : 'local';
  if (resumeDir) {
    console.log(`\n🚀 MetaBuilder — ${args.extend ? 'extendiendo' : 'reanudando'} ${resumeDir}`);
    console.log(`   deploy=${deploy}\n`);
  } else {
    console.log(`\n🚀 MetaBuilder — "${args.idea.slice(0, 90)}"`);
    console.log(`   vertical=${args.appType} · scope=${args.scope} · deploy=${deploy}\n`);
  }
}

// Streaming con updates: cada nodo reporta su historial apenas termina,
// y entre medio los agentes imprimen actividad de herramientas (stderr).
let result;
let input = initial;
for (;;) {
  const stream = await app.stream(input, { ...runConfig, streamMode: 'updates' });
  for await (const chunk of stream) {
    for (const [node, update] of Object.entries(chunk)) {
      if (node === '__interrupt__') continue;
      reportUpdate(node, update);
    }
  }

  const state = await app.getState(runConfig);
  const interrupts = (state.tasks ?? []).flatMap((t) => t.interrupts ?? []);
  result = state.values;
  if (!interrupts.length) break;

  // El nodo confirm suspende el grafo hasta que el usuario apruebe.
  printPlan(result.plan);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question('\n¿Construir con este plan? [S/n] ')).trim().toLowerCase();
  rl.close();
  input = new Command({ resume: ans || 's' });
}

const elapsedMs = Date.now() - startedAt;
const mins = Math.floor(elapsedMs / 60_000);
const secs = Math.round((elapsedMs % 60_000) / 1000);
const duration = mins ? `${mins}m ${secs}s` : `${secs}s`;

console.log('\n=== Resultado ===');
console.log('status:', result.status);
console.log('duración total:', duration);
console.log('proyecto:', result.projectDir);
if (result.lastError) console.log('error:', result.lastError);
console.log('\n=== Historial ===');
for (const h of result.history) console.log(`[${h.node}] ${h.msg}`);

process.exit(result.status === 'done' ? 0 : 1);
