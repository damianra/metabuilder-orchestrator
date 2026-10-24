// npm run dashboard — levanta la API (src/dashboard/server.js) y la UI
// (dashboard/, Vite dev :4173 con proxy /api → :4100) en un solo proceso.
// Ctrl+C mata ambos. Sin dep de concurrently: dos spawns + kill propio.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config } from '../config.js';

const root = config.rootDir;
const procs = [
  spawn(process.execPath, [join(root, 'src/dashboard/server.js')], { stdio: 'inherit', cwd: root }),
  spawn('npm', ['--prefix', join(root, 'dashboard'), 'run', 'dev'], { stdio: 'inherit', cwd: root }),
];

const shutdown = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const p of procs) p.on('close', (code) => {
  // Si un lado muere, no dejar el otro colgado.
  if (code !== null && code !== 0) shutdown();
});

console.log('dashboard → API http://127.0.0.1:4100 · UI http://127.0.0.1:4173');
