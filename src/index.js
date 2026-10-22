import { buildGraph } from './orchestrator/graph.js';

function parseArgs(argv) {
  const args = { noPush: false, keepGoing: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-push') args.noPush = true;
    else if (a === '--keep-going') args.keepGoing = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i];
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.idea) {
  console.error('Uso: npm start -- --idea "<descripcion>" [--scope fullstack|frontend|backend] [--name slug] [--no-push] [--keep-going]');
  process.exit(2);
}

const initial = {
  idea: args.idea,
  scope: args.scope ?? 'fullstack',
  projectSlug: args.name ?? '',
  noPush: args.noPush,
  keepGoing: args.keepGoing,
};

const app = buildGraph();
const result = await app.invoke(initial);

console.log('\n=== Resultado ===');
console.log('status:', result.status);
console.log('proyecto:', result.projectDir);
if (result.lastError) console.log('error:', result.lastError);
console.log('\n=== Historial ===');
for (const h of result.history) console.log(`[${h.node}] ${h.msg}`);

process.exit(result.status === 'done' ? 0 : 1);
