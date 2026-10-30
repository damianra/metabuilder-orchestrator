import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { config } from '../config.js';
import { runAgentPrompt } from '../tools/acp.js';
import { apiSurfaceFor, apiSurfaceKindOf } from '../tools/api-surface.js';
import { stacksFor } from '../stacks/index.js';
import { activity, log, loadPrompt, runLogPath, textFeed } from './common.js';

/**
 * Sub-agente QA: una sesión Devin revisa la app terminada contra
 * AGENTS.md + plan.json e idea. Devuelve APPROVED → finalize, o
 * ISSUES → el loop fix los corrige (consume finalRetries).
 */
export async function reviewerNode(state) {
  // Review scoped (v13 #15): en vez de que el agente explore el árbol
  // (ls -R + reads sueltos = tokens), le pasamos el inventario — los
  // archivos fuente a revisar y el api-surface del dominio. El walk es
  // filesystem-based: en este punto la app todavía no tiene `git init`
  // (corre en finalize, un nodo después).
  const fileList = sourceFiles(state.projectDir).join('\n') || '(sin inventario)';
  const backend = stacksFor(state).backend;
  const surface = backend
    ? apiSurfaceFor(state.projectDir, { kind: apiSurfaceKindOf(backend.id) })
        .map((e) => `${e.method} ${e.path}`)
        .join('\n') || '(sin endpoints)'
    : '(sin backend)';

  const prompt = loadPrompt('reviewer', {
    idea: state.idea,
    scope: state.scope,
    fileList,
    apiSurface: surface,
  });

  const feed = textFeed();
  const res = await runAgentPrompt({
    agent: state.agent,
    prompt,
    cwd: state.projectDir,
    timeoutMs: config.devinTimeoutMs,
    logPath: runLogPath(state, 'review'),
    onActivity: activity,
    onText: feed.onText,
  });
  feed.flush();

  if (!res.ok) {
    return {
      status: 'failed',
      lastError: `reviewer falló: ${res.error}`,
      history: [log('review', `${res.engine ?? 'agente'} falló: ${res.error}`)],
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

// Inventario de archivos fuente — excluye deps, builds, vcs y media
// generada (no son reviewables y solo gastarían líneas de prompt).
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.venv', 'venv', '__pycache__',
  'dist', 'dist-server', 'out', 'build', 'uploads', 'coverage',
]);

function sourceFiles(dir, base = dir) {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(f) && !f.startsWith('.')) out.push(...sourceFiles(p, base));
    } else {
      out.push(relative(base, p));
    }
  }
  return out;
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
