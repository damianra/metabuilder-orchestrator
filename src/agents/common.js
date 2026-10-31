import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../tools/shell.js';

export const log = (node, msg) => ({ ts: new Date().toISOString(), node, msg });

// --- Reporter de actividad live (stderr para no ensuciar stdout del CLI) ---
let quiet = false;
export const setQuiet = (v) => { quiet = v; };
export function activity(msg) {
  if (!quiet) process.stderr.write(`   ▸ ${msg}\n`);
}

// Feed del texto del agente → stderr (cae en jobs/<id>.log vía el
// worker, igual que activity). Los chunks de ACP llegan como tokens
// sueltos — se acumulan y se emiten por ventana/tamaño para que el log
// quede legible en vez de una línea por token. Llamar flush() cuando
// el prompt termina para no perder la cola del último mensaje.
export function textFeed({ maxLen = 280, flushMs = 3000, out = process.stderr } = {}) {
  let buf = '';
  // last arranca en "ahora": el primer emit también espera la ventana —
  // con 0 la diferencia epoch supera flushMs y saldría un emit por token.
  let last = Date.now();
  const emit = () => {
    const line = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    last = Date.now();
    if (!quiet && line)
      out.write(`   ▸ ${line.slice(0, 500)}${line.length > 500 ? '…' : ''}\n`);
  };
  return {
    onText(t) {
      buf += t;
      if (buf.length >= maxLen || Date.now() - last >= flushMs) emit();
    },
    flush: emit,
  };
}

export function planPath(projectDir) {
  return join(projectDir, 'plan.json');
}

export function readPlan(projectDir) {
  const p = planPath(projectDir);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function writePlan(projectDir, plan) {
  writeFileSync(planPath(projectDir), JSON.stringify(plan, null, 2) + '\n');
}

export function runLogPath(state, name) {
  return state.runDir ? join(state.runDir, 'prompts', `${name}.rpc.jsonl`) : undefined;
}

export function loadPrompt(name, vars = {}) {
  const promptsDir = fileURLToPath(new URL('../prompts', import.meta.url));
  return interpolate(readFileSync(join(promptsDir, `${name}.md`), 'utf8'), vars);
}

export function loadTemplate(name, vars = {}) {
  const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));
  return interpolate(readFileSync(join(templatesDir, name), 'utf8'), vars);
}

function interpolate(text, vars) {
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{{${k}}}`, String(v));
  }
  return text;
}

/**
 * `git init` + initial commit idempotente en la app guardada — las
 * apps de workspace (pestañas Backend/Diseño) nacen con repo propio
 * igual que las del pipeline (publish hace init lazily si falta, pero
 * sin historia hasta entonces). El caller decide qué hacer con el
 * resultado (los saves lo tratan warn-only).
 */
export async function initGitRepo(dir) {
  const g = (args) =>
    run(`git ${args}`, { cwd: dir, timeoutMs: 60_000, env: { GIT_TERMINAL_PROMPT: '0' } });
  const init = await g('init -b main');
  if (!init.ok) return init;
  await g('add -A');
  if (!(await g('diff --cached --quiet')).ok) {
    return g(
      '-c user.name="MetaBuilder" -c user.email="metabuilder@localhost" ' +
        'commit -m "chore: initial commit — MetaBuilder workspace"',
    );
  }
  return { ok: true };
}
