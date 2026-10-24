// Sub-agente de validación de PRs del orquestador.
// Uso: npm run validate:pr -- <numero>
//
// 1. Trae el PR de GitHub (head/base/title).
// 2. Crea un worktree temporal del head — no toca el checkout del usuario.
// 3. npm install + una sesión Devin (prompts/pr-validator.md) que revisa
//    el diff y corre la validación funcional en el worktree.
// 4. Comenta el veredicto en el PR. El GITHUB_TOKEN nunca llega al agente:
//    solo este script lo usa, para leer el PR y comentar.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { run } from './tools/shell.js';
import { runDevinPrompt } from './tools/devin.js';
import { commentOnPR, getPR } from './tools/github.js';
import { activity, loadPrompt } from './agents/common.js';

// Del resultado del agente extrae solo el bloque "## Validación funcional"
// (sin la narración de trabajo). Sin bloque o con error → ⚠️.
export const extractVerdictComment = (res) => {
  if (!res.ok) {
    return `## Validación funcional (sub-agente)\n\n⚠️ El sub-agente de validación falló: ${res.error}\n\nVeredicto: ⚠️ REQUIERE REVISIÓN`;
  }
  const marker = res.text.lastIndexOf('## Validación funcional');
  if (marker >= 0) return res.text.slice(marker);
  return `## Validación funcional (sub-agente)\n\n⚠️ El sub-agente no devolvió el bloque de veredicto requerido. Salida:\n\n${res.text.slice(-2000)}\n\nVeredicto: ⚠️ REQUIERE REVISIÓN`;
};

const main = async () => {
  const prNumber = Number(process.argv[2]);
  if (!prNumber) {
    console.error('uso: npm run validate:pr -- <numero>');
    process.exit(1);
  }
  if (!config.githubToken) {
    console.error('GITHUB_TOKEN requerido en .env');
    process.exit(1);
  }

  // owner/repo desde el remote origin (git@github.com:o/r.git o https)
  const remote = (await run('git remote get-url origin', { cwd: config.rootDir })).stdout.trim();
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!m) {
    console.error(`no pude parsear owner/repo de origin: ${remote}`);
    process.exit(1);
  }
  const [, owner, repo] = m;

  console.log(`\n🔍 validate:pr — PR #${prNumber} en ${owner}/${repo}\n`);

  const pr = await getPR(config.githubToken, owner, repo, prNumber);
  const { base, head } = { base: pr.base.ref, head: pr.head.ref };
  console.log(`   "${pr.title}" (${base}..${head})`);

  await run('git fetch origin', { cwd: config.rootDir });

  // Worktree temporal: el agente valida sobre una copia aislada del head.
  const worktree = join(mkdtempSync(join(tmpdir(), `mb-pr-${prNumber}-`)), 'wt');
  try {
    const add = await run(`git worktree add ${worktree} origin/${head}`, { cwd: config.rootDir });
    if (!add.ok) {
      console.error(`git worktree add falló: ${add.stderr}`);
      process.exit(1);
    }
    console.log(`   worktree: ${worktree}`);

    activity('npm install en el worktree…');
    const install = await run('npm install', { cwd: worktree, timeoutMs: 300_000 });
    if (!install.ok) console.warn(`   ⚠ npm install falló (el agente lo verá): ${install.stderr.slice(-200)}`);

    const diffStat = (await run(`git diff --stat origin/${base}...HEAD`, { cwd: worktree })).stdout;
    let diff = (await run(`git diff origin/${base}...HEAD`, { cwd: worktree })).stdout;
    if (diff.length > 30_000) diff = diff.slice(0, 30_000) + '\n\n[... diff truncado a 30k chars ...]';

    const prompt = loadPrompt('pr-validator', {
      number: prNumber,
      title: pr.title,
      base,
      head,
      diffStat,
      diff,
    });

    console.log('   sub-agente Devin validando…\n');
    const res = await runDevinPrompt({
      prompt,
      cwd: worktree,
      timeoutMs: config.devinTimeoutMs,
      onActivity: activity,
    });

    await commentOnPR(config.githubToken, owner, repo, prNumber, extractVerdictComment(res));
    console.log(`\n✔ veredicto comentado en PR #${prNumber} — ${pr.html_url}`);
  } finally {
    await run(`git worktree remove --force ${worktree}`, { cwd: config.rootDir });
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
