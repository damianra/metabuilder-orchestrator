import { config } from '../config.js';
import { runDevinPrompt } from '../tools/devin.js';
import { activity, log, loadPrompt, runLogPath } from './common.js';

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
    onActivity: activity,
  });

  if (!res.ok) {
    return {
      status: 'failed',
      lastError: `reviewer falló: ${res.error}`,
      history: [log('review', `Devin falló: ${res.error}`)],
    };
  }

  const result = parseReviewResult(res.text);
  if (result.approved) {
    return {
      lastError: null,
      status: 'reviewed',
      history: [log('review', 'QA aprobado — listo para finalizar')],
    };
  }

  return {
    lastError: 'QA encontró issues',
    lastOutput: result.issues.slice(-3000),
    history: [log('review', `issues reportados: ${result.issues.slice(0, 200)}`)],
  };
}

/**
 * Clasifica la respuesta del QA: 'RESULT: APPROVED' → aprobado;
 * 'RESULT: ISSUES' + detalle → issues (o el texto completo si el
 * agente no emitió el marcador).
 */
export function parseReviewResult(text) {
  if (/RESULT:\s*APPROVED/i.test(text)) return { approved: true };
  const issues = text.match(/RESULT:\s*ISSUES([\s\S]*)$/i)?.[1]?.trim() || text;
  return { approved: false, issues };
}
