import { Command } from '@langchain/langgraph';
import { createInterface } from 'node:readline/promises';
import { buildGraph } from './orchestrator/graph.js';
import { getVertical, inferAppType, listVerticals } from './verticals/index.js';

function parseArgs(argv) {
  const args = { noPush: false, keepGoing: false, yes: false, github: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-push') args.noPush = true;
    else if (a === '--keep-going') args.keepGoing = true;
    else if (a === '--github') args.github = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i];
    }
  }
  return args;
}

function printPlan(plan) {
  console.log(`\n=== Plan: ${plan.projectName} (${plan.appType}, scope ${plan.scope}) ===`);
  for (const s of plan.steps) {
    console.log(`  ${s.id}. [${s.type}] ${s.description.slice(0, 110)}${s.description.length > 110 ? '…' : ''}`);
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
  const interactive = Boolean(process.stdin.isTTY);
  const asker = createAsker();
  try {
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
    if (!args.name && interactive) {
      args.name = await asker.ask('Nombre del proyecto (slug, vacío = derivar de la idea): ');
    }
    if (!args.phone && interactive) {
      args.phone = await asker.ask('WhatsApp del negocio (ej. 5491155500000, vacío = placeholder): ');
    }
    if (!args.github && !args.noPush && interactive) {
      const g = await asker.ask('¿Crear repo en GitHub y publicar en Pages? [s/N] ');
      args.github = /^s/i.test(g);
      if (!args.github) args.noPush = true;
    }
  } finally {
    asker.close();
  }
  return args;
}

const args = await collectArgs(parseArgs(process.argv.slice(2)));

if (!args.idea) {
  console.error('Falta --idea "<descripcion>"');
  process.exit(2);
}
if (!getVertical(args.appType) && args.appType !== 'custom') {
  console.error(`--app-type desconocido "${args.appType}" (usá ${listVerticals().join('|')} o custom)`);
  process.exit(2);
}

// Confirmación de plan: solo si la salida es interactiva y no se pasó --yes.
const confirmPlan = Boolean(process.stdin.isTTY) && !args.yes;

const initial = {
  idea: args.idea,
  scope: args.scope,
  appType: args.appType,
  projectSlug: args.name ?? '',
  noPush: args.noPush,
  keepGoing: args.keepGoing,
  confirmPlan,
  deployGithub: args.github,
  whatsappPhone: args.phone ?? '',
};

const app = buildGraph();
const runConfig = { configurable: { thread_id: `run-${Date.now()}` } };

let result = await app.invoke(initial, runConfig);

// El nodo confirm suspende el grafo con interrupt() hasta que el usuario apruebe.
while (result.__interrupt__?.length) {
  printPlan(result.plan);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question('\n¿Construir con este plan? [S/n] ')).trim().toLowerCase();
  rl.close();
  result = await app.invoke(new Command({ resume: ans || 's' }), runConfig);
}

console.log('\n=== Resultado ===');
console.log('status:', result.status);
console.log('proyecto:', result.projectDir);
if (result.lastError) console.log('error:', result.lastError);
console.log('\n=== Historial ===');
for (const h of result.history) console.log(`[${h.node}] ${h.msg}`);

process.exit(result.status === 'done' ? 0 : 1);
