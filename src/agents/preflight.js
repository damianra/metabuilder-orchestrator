import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { checkDevinAuth } from '../tools/devin.js';
import { ensureProjectDir } from '../tools/slug.js';
import { getVertical } from '../verticals/index.js';
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

  // Vertical conocido con frontend → copiar skeleton + npm install
  // (scaffold determinístico: el agente no gasta tiempo ni tokens en init).
  const vertical = getVertical(state.appType);
  const withFrontend = state.scope !== 'backend';
  if (vertical && withFrontend && !existsSync(join(dir, 'package.json'))) {
    const skeleton = join(config.templatesDir, 'app-skeleton');
    cpSync(skeleton, dir, { recursive: true });

    // Personalizar placeholders del skeleton
    for (const f of ['package.json', 'index.html', 'src/App.jsx']) {
      const p = join(dir, f);
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__APP_NAME__', slug));
    }
    history.push(log('preflight', `skeleton copiado (${vertical.name})`));

    const install = await run('npm install', { cwd: dir, timeoutMs: 300_000 });
    if (!install.ok) {
      return {
        status: 'failed',
        lastError: `npm install del skeleton falló: ${install.stderr.slice(-500)}`,
        history: [...history, log('preflight', 'npm install falló')],
      };
    }
    history.push(log('preflight', 'dependencias instaladas'));
  }

  return {
    projectSlug: slug,
    projectDir: dir,
    runDir,
    status: 'preflighted',
    history: [...history, log('preflight', `proyecto: ${dir}`)],
  };
}
