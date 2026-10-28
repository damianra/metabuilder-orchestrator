import { run } from './shell.js';

// Registry de `npm install` en background por directorio de proyecto.
// preflight lo dispara apenas copia los skeletons (overlap con el
// planner y la confirmación humana del plan); builder/verifier lo
// awaitan antes de necesitar node_modules. El estado de LangGraph no
// puede llevar promesas — por eso vive a nivel módulo.
const pending = new Map();
const results = new Map();

export function startInstall(dir, cmd = 'npm install') {
  if (!pending.has(dir)) {
    pending.set(dir, run(cmd, { cwd: dir, timeoutMs: 300_000 }));
  }
  return pending.get(dir);
}

export const isInstalling = (dir) => pending.has(dir) && !results.has(dir);

// Limpia la cache por dir — necesario cuando el dir se borra y se
// recrea en la misma ruta (design-work): si no, la segunda creación
// hereda el resultado viejo y queda sin node_modules.
export function clearInstall(dir) {
  pending.delete(dir);
  results.delete(dir);
}

export async function awaitInstall(dir) {
  if (!pending.has(dir)) return { ok: true };
  if (!results.has(dir)) results.set(dir, await pending.get(dir));
  return results.get(dir);
}
