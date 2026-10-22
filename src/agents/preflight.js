import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { checkDevinAuth } from '../tools/devin.js';
import { ensureProjectDir } from '../tools/slug.js';
import { log } from './common.js';

const REQUIRED_BINS = ['devin', 'node', 'npm', 'git'];

export async function preflightNode(state) {
  const history = [log('preflight', 'verificando binarios y autenticación')];

  for (const bin of REQUIRED_BINS) {
    const res = await run(`command -v ${bin}`);
    if (!res.ok) {
      return {
        status: 'failed',
        lastError: `binario requerido no encontrado: ${bin}`,
        history: [...history, log('preflight', `falta ${bin}`)],
      };
    }
  }

  const auth = await checkDevinAuth();
  if (!auth.ok) {
    return {
      status: 'failed',
      lastError: `Devin no autentica vía ACP: ${auth.error}`,
      history: [...history, log('preflight', `auth falló: ${auth.error}`)],
    };
  }

  const name = state.projectSlug || state.idea || 'app';
  const { slug, dir } = ensureProjectDir(config.generatedAppsDir, name);

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}`;
  const runDir = join(config.runsDir, runId);
  mkdirSync(join(runDir, 'prompts'), { recursive: true });

  copyFileSync(
    join(config.templatesDir, 'AGENTS.md'),
    join(dir, 'AGENTS.md'),
  );

  return {
    projectSlug: slug,
    projectDir: dir,
    runDir,
    status: 'preflighted',
    history: [...history, log('preflight', `proyecto: ${dir}`)],
  };
}
