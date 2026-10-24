import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const devinSlotsDir = () => join(homedir(), '.metabuilder', 'devin-slots');

// Un slot es reciclable si el proceso dueño murió (locks huérfanos
// tras un kill/crash) o si quedó sin pid file y es viejo (race con
// quien lo acaba de crear y aún no escribió el pid).
function slotIsStale(dir) {
  let pid = NaN;
  try {
    pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim());
  } catch {
    /* sin pid aún */
  }
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }
  try {
    return Date.now() - statSync(dir).mtimeMs > 60_000;
  } catch {
    return false;
  }
}

/**
 * Semáforo global de sesiones Devin entre procesos. Cada slot es un
 * directorio slot-N/ (mkdir es atómico entre procesos) con un `pid`
 * file adentro. Bloquea con polling hasta conseguir uno; devuelve la
 * función release(). max viene de config.maxDevinSessions
 * (MAX_CONCURRENT_DEVIN_SESSIONS, default 1 → serial total).
 */
export async function acquireDevinSlot({ max = config.maxDevinSessions, pollMs = 2000, onWait } = {}) {
  const base = devinSlotsDir();
  mkdirSync(base, { recursive: true });
  let waited = false;
  for (;;) {
    for (let i = 0; i < max; i++) {
      const dir = join(base, `slot-${i}`);
      try {
        if (existsSync(dir)) {
          if (!slotIsStale(dir)) continue;
          rmSync(dir, { recursive: true, force: true });
        }
        mkdirSync(dir);
        writeFileSync(join(dir, 'pid'), String(process.pid));
        return () => {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            /* otro proceso ya lo recicló — no pasa nada */
          }
        };
      } catch {
        /* race reciclando o al crear — probar el siguiente slot */
      }
    }
    if (!waited) onWait?.();
    waited = true;
    await sleep(pollMs);
  }
}
