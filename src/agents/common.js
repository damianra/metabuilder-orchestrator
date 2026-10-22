import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const log = (node, msg) => ({ ts: new Date().toISOString(), node, msg });

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

export function loadPrompt(name, vars = {}) {
  let text = readFileSync(
    join(new URL('../prompts', import.meta.url).pathname, `${name}.md`),
    'utf8',
  );
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{{${k}}}`, String(v));
  }
  return text;
}
