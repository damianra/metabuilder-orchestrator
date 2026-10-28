// npm run dashboard — levanta la API (src/dashboard/server.js), la UI
// (dashboard/, Vite dev :4173 con proxy /api → :4100) y el worker de la
// cola (queue.js watch — los jobs no quedan pending sin consumidor)
// en un solo proceso. Ctrl+C mata los tres. Sin dep de concurrently.
//
// Se spawnea vite.js directo (no `npm run dev`): matar el proceso mata
// el server real — con npm de wrapper el nieto `sh -c vite` quedaba
// huérfano en :4173 tras la señal.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

const root = config.rootDir;
const viteBin = join(root, 'dashboard/node_modules/vite/bin/vite.js');
const apiPort = process.env.DASHBOARD_PORT ?? '4100';

if (!existsSync(viteBin)) {
  console.error('falta dashboard/node_modules — corré: npm --prefix dashboard install');
  process.exit(1);
}

const procs = [
  spawn(process.execPath, [join(root, 'src/dashboard/server.js')], { stdio: 'inherit', cwd: root }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit', cwd: join(root, 'dashboard') }),
  spawn(process.execPath, [join(root, 'src/queue.js'), 'watch'], { stdio: 'inherit', cwd: root }),
];

let stopping = false;
const shutdown = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  // Esperar el close real (máx 3s) y escalar a SIGKILL a los que
  // queden — salir antes dejaba hijos vivos colgados del tty.
  const closed = Promise.all(
    procs.map((p) => new Promise((r) => p.once('close', r))),
  );
  const killAll = () => {
    for (const p of procs) {
      // killed = "señal enviada", no "proceso muerto" — un hijo que
      // ignore SIGTERM sigue con exitCode/signalCode en null.
      if (p.exitCode === null && p.signalCode === null) {
        try {
          p.kill('SIGKILL');
        } catch {
          /* ya murió */
        }
      }
    }
  };
  const grace = setTimeout(() => {
    killAll();
    process.exit(code);
  }, 3000);
  grace.unref();
  closed.then(() => {
    clearTimeout(grace);
    process.exit(code);
  });
};

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
// Cerrar la terminal manda SIGHUP (no SIGINT/SIGTERM) — sin este
// handler los hijos (vite en :4173, api, worker) quedaban huérfanos
// ocupando los puertos y la siguiente corrida degradaba a :4174 con
// un cache deps_temp_* a medio optimizar.
process.on('SIGHUP', () => shutdown());
for (const p of procs) {
  // Cualquier cierre que no iniciamos nosotros tumba el par (code===null
  // = muerte por señal/OOM — API sin UI o UI sin API no sirven).
  p.on('close', (code) => {
    if (!stopping) shutdown(code ?? 1);
  });
  p.on('error', (err) => {
    console.error(err.message);
    shutdown(1);
  });
}

console.log(
  `dashboard → API http://127.0.0.1:${apiPort} · UI http://127.0.0.1:4173 · worker (cola jobs/)`,
);
