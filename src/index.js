import { Command } from '@langchain/langgraph';
import { createInterface } from 'node:readline/promises';
import { buildGraph } from './orchestrator/graph.js';
import { inferAppType, listVerticals } from './verticals/index.js';

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

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(question);
  rl.close();
  return ans.trim().toLowerCase();
}

const args = parseArgs(process.argv.slice(2));

if (!args.idea) {
  console.error(
    'Uso: npm start -- --idea "<descripcion>" [--scope fullstack|frontend|backend]\n' +
      `                   [--app-type ${listVerticals().join('|')}|custom] [--name slug]\n` +
      '                   [--github  (crea repo + GitHub Pages; requiere GITHUB_TOKEN)]\n' +
      '                   [--no-push] [--keep-going] [-y|--yes  (sin confirmación de plan)]',
  );
  process.exit(2);
}

const scope = args.scope ?? 'fullstack';
const appType = args.appType ?? inferAppType(args.idea, scope);

// Confirmación de plan: solo si la salida es interactiva y no se pasó --yes.
const confirmPlan = Boolean(process.stdin.isTTY) && !args.yes;

const initial = {
  idea: args.idea,
  scope,
  appType,
  projectSlug: args.name ?? '',
  noPush: args.noPush,
  keepGoing: args.keepGoing,
  confirmPlan,
  deployGithub: args.github,
};

const app = buildGraph();
const runConfig = { configurable: { thread_id: `run-${Date.now()}` } };

let result = await app.invoke(initial, runConfig);

// El nodo confirm suspende el grafo con interrupt() hasta que el usuario apruebe.
while (result.__interrupt__?.length) {
  printPlan(result.plan);
  const ans = await ask('\n¿Construir con este plan? [S/n] ');
  result = await app.invoke(new Command({ resume: ans || 's' }), runConfig);
}

console.log('\n=== Resultado ===');
console.log('status:', result.status);
console.log('proyecto:', result.projectDir);
if (result.lastError) console.log('error:', result.lastError);
console.log('\n=== Historial ===');
for (const h of result.history) console.log(`[${h.node}] ${h.msg}`);

process.exit(result.status === 'done' ? 0 : 1);
