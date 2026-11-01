import { execa } from 'execa';

/**
 * Ejecuta un comando de shell arbitrario sin lanzar excepción.
 * Devuelve { ok, exitCode, stdout, stderr, timedOut }.
 */
export async function run(command, { cwd, timeoutMs = 5 * 60 * 1000, env = {} } = {}) {
  // detached: el sh -c queda líder de un process group nuevo. El
  // timeout lo manejamos nosotros (el de execa solo señala al hijo
  // directo): SIGKILL al GRUPO → mata sh + npm + vite/expo/webServer
  // de Playwright. Sin esto cada timeout/cancel dejaba dev servers
  // huérfanos con PPID=1 escuchando en su puerto.
  const killGroup = (pid) => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* grupo ya muerto */ }
  };
  const sub = execa(command, {
    shell: true,
    cwd,
    env,
    reject: false,
    all: false,
    detached: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(sub.pid);
  }, timeoutMs);
  try {
    const res = await sub;
    return {
      ok: res.exitCode === 0 && !timedOut,
      exitCode: res.exitCode,
      stdout: res.stdout ?? '',
      stderr: timedOut
        ? (res.stderr ?? '') + '\n[metabuilder] comando excedió el timeout'
        : (res.stderr ?? ''),
      timedOut,
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: null,
      stdout: err.stdout ?? '',
      stderr: (err.stderr ?? err.shortMessage ?? String(err)) +
        (timedOut ? '\n[metabuilder] comando excedió el timeout' : ''),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}
