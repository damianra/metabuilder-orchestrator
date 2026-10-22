import { execa, ExecaError } from 'execa';

/**
 * Ejecuta un comando de shell arbitrario sin lanzar excepción.
 * Devuelve { ok, exitCode, stdout, stderr, timedOut }.
 */
export async function run(command, { cwd, timeoutMs = 5 * 60 * 1000, env = {} } = {}) {
  try {
    const res = await execa(command, {
      shell: true,
      cwd,
      timeout: timeoutMs,
      env,
      reject: false,
      all: false,
    });
    return {
      ok: res.exitCode === 0 && !res.timedOut,
      exitCode: res.exitCode,
      stdout: res.stdout ?? '',
      stderr: res.timedOut
        ? (res.stderr ?? '') + '\n[metabuilder] comando excedió el timeout'
        : (res.stderr ?? ''),
      timedOut: Boolean(res.timedOut),
    };
  } catch (err) {
    if (err instanceof ExecaError && err.timedOut) {
      return {
        ok: false,
        exitCode: null,
        stdout: err.stdout ?? '',
        stderr: (err.stderr ?? '') + '\n[metabuilder] comando excedió el timeout',
        timedOut: true,
      };
    }
    return {
      ok: false,
      exitCode: null,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err),
      timedOut: false,
    };
  }
}
