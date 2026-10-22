import { config } from '../config.js';
import { runDevinPrompt } from '../tools/devin.js';
import { log, loadPrompt, runLogPath } from './common.js';

/**
 * Sub-agente QA: una sesión Devin revisa la app terminada contra
 * AGENTS.md + plan.json e idea. Devuelve APPROVED → finalize, o
 * ISSUES → el loop fix los corrige (consume finalRetries).
 */
export async function reviewerNode(state) {
  const prompt = loadPrompt('reviewer', {
    idea: state.idea,
    scope: state.scope,
  });

  const res = await runDevinPrompt({
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, 'review'),
  });

  if (!res.ok) {
    return {
      status: 'failed',
      lastError: `reviewer falló: ${res.error}`,
      history: [log('review', `Devin falló: ${res.error}`)],
    };
  }

  if (/RESULT:\s*APPROVED/i.test(res.text)) {
    return {
      lastError: null,
      status: 'reviewed',
      history: [log('review', 'QA aprobado — listo para finalizar')],
    };
  }

  const issues = res.text.match(/RESULT:\s*ISSUES([\s\S]*)$/i)?.[1]?.trim() || res.text;
  return {
    lastError: 'QA encontró issues',
    lastOutput: issues.slice(-3000),
    history: [log('review', `issues reportados: ${issues.slice(0, 200)}`)],
  };
}
