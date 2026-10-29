import { run } from './shell.js';

// Registry de installs en background por (dir, comando): preflight lo
// dispara apenas copia los skeletons (overlap con el planner y la
// confirmación humana del plan); builder/verifier lo awaitan antes de
// necesitar las deps. El comando sale del `toolchain` del stack —
// un proyecto puede tener más de uno (npm del front + pip del back).
// El estado de LangGraph no puede llevar promesas — por eso vive a
// nivel módulo.
const pending = new Map(); // dir → Map<cmd, Promise>
const results = new Map(); // dir → Map<cmd, result>

export function startInstall(dir, cmd = 'npm install') {
  let cmds = pending.get(dir);
  if (!cmds) pending.set(dir, (cmds = new Map()));
  if (!cmds.has(cmd)) {
    cmds.set(cmd, run(cmd, { cwd: dir, timeoutMs: 300_000 }));
  }
  return cmds.get(cmd);
}

// Hay algún comando pendiente cuyo resultado todavía no se awaitó.
export const isInstalling = (dir) => {
  const cmds = pending.get(dir);
  return Boolean(cmds?.size) && [...cmds.keys()].some((c) => !results.get(dir)?.has(c));
};

// Limpia la cache por dir — necesario cuando el dir se borra y se
// recrea en la misma ruta (design-work): si no, la segunda creación
// hereda el resultado viejo y queda sin node_modules.
export function clearInstall(dir) {
  pending.delete(dir);
  results.delete(dir);
}

// Espera TODOS los installs registrados para el dir (los que lleguen
// después de un await previo se incorporan — extend puede sumar un
// toolchain nuevo). Falla el primero → {ok:false} con el cmd
// prefijado en stderr para saber cuál fue.
export async function awaitInstall(dir) {
  const cmds = pending.get(dir);
  if (!cmds?.size) return { ok: true };
  if (!results.has(dir)) results.set(dir, new Map());
  const rs = results.get(dir);
  for (const [cmd, p] of cmds) {
    if (!rs.has(cmd)) rs.set(cmd, await p);
  }
  for (const [cmd, r] of rs) {
    if (!r.ok) return { ...r, stderr: `[${cmd}] ${r.stderr}` };
  }
  return { ok: true };
}
