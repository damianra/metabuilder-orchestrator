// Sub-agente de validación de PRs del orquestador.
// Uso:
//   npm run validate:pr -- <numero>   un PR puntual
//   npm run validate:pr               todos los PRs abiertos pendientes
//   npm run validate:pr -- --watch [minutos]   polling continuo
//
// 1. Trae el PR de GitHub (head/base/title).
// 2. Crea un worktree temporal del head — no toca el checkout del usuario.
// 3. npm install + una sesión Devin (prompts/pr-validator.md) que revisa
//    el diff y corre la validación funcional en el worktree.
// 4. Comenta el veredicto en el PR con el head SHA embebido — un push
//    nuevo vuelve a marcar el PR como pendiente. El GITHUB_TOKEN nunca
//    llega al agente: solo este script lo usa, para leer y comentar.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { run } from './tools/shell.js';
import { runAgentPrompt } from './tools/acp.js';

// --engine <id>: override del engine de la sesión (sin tocar settings).
// Se quita del argv para que el parseo del número de PR lo ignore.
const ENGINE_FLAG = (() => {
  const i = process.argv.indexOf('--engine');
  return i >= 0 ? process.argv.splice(i, 2)[1] : null;
})();
import { commentOnPR, getPR, getPRComments, listOpenPRs } from './tools/github.js';
import { activity, loadPrompt, textFeed } from './agents/common.js';

const VERDICT_MARKER = '## Validación funcional';
const shaTag = (sha) => `head:${sha.slice(0, 7)}`;

// Del resultado del agente extrae solo el bloque "## Validación funcional"
// (sin la narración de trabajo). Sin bloque o con error → ⚠️.
export const extractVerdictComment = (res) => {
  if (!res.ok) {
    return `## Validación funcional (sub-agente)\n\n⚠️ El sub-agente de validación falló: ${res.error}\n\nVeredicto: ⚠️ REQUIERE REVISIÓN`;
  }
  const marker = res.text.lastIndexOf(VERDICT_MARKER);
  if (marker >= 0) return res.text.slice(marker);
  return `## Validación funcional (sub-agente)\n\n⚠️ El sub-agente no devolvió el bloque de veredicto requerido. Salida:\n\n${res.text.slice(-2000)}\n\nVeredicto: ⚠️ REQUIERE REVISIÓN`;
};

// Un PR está pendiente si ningún comentario de validación corresponde a
// su head actual. El veredicto embebe <!-- head:<sha7> --> — un push
// posterior cambia el sha y el PR vuelve a necesitar validación.
export const prNeedsValidation = (comments, headSha) =>
  !comments.some((c) => c.body?.includes(VERDICT_MARKER) && c.body.includes(shaTag(headSha)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function validateOnePR({ prNumber, owner, repo }) {
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
      return false;
    }
    console.log(`   worktree: ${worktree}`);

    activity('npm ci en el worktree…');
    // ci --prefer-offline usa la caché local de npm — bastante más
    // rápido que install sobre un worktree sin node_modules. Fallback
    // a install por si el lockfile está viejo respecto a package.json.
    let install = await run('npm ci --prefer-offline --no-audit --no-fund', { cwd: worktree, timeoutMs: 300_000 });
    if (!install.ok) install = await run('npm install', { cwd: worktree, timeoutMs: 300_000 });
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

    console.log('   sub-agente validando…\n');
    const feed = textFeed();
    const res = await runAgentPrompt({
      agent: ENGINE_FLAG || undefined,
      prompt,
      cwd: worktree,
      timeoutMs: config.devinTimeoutMs,
      onActivity: activity,
      onText: feed.onText,
    });
    feed.flush();

    const verdict = extractVerdictComment(res) + `\n\n<!-- validate-pr ${shaTag(pr.head.sha)} -->`;
    await commentOnPR(config.githubToken, owner, repo, prNumber, verdict);
    console.log(`\n✔ veredicto comentado en PR #${prNumber} — ${pr.html_url}`);
    return true;
  } finally {
    // Si el sub-agente dejó servicios corriendo dentro del worktree
    // (preview, api, e2e webServer), matarlos ANTES de borrar el dir
    // — sino quedan huérfanos con cwd muerto.
    await run(`pkill -f '${worktree}' || true`, { cwd: config.rootDir, timeoutMs: 10_000 });
    await run(`git worktree remove --force ${worktree}`, { cwd: config.rootDir });
  }
}

// PRs abiertos cuyo head actual todavía no tiene veredicto del sub-agente.
async function listPendingPRs(owner, repo) {
  const prs = await listOpenPRs(config.githubToken, owner, repo);
  const pending = [];
  for (const pr of prs) {
    const comments = await getPRComments(config.githubToken, owner, repo, pr.number);
    if (prNeedsValidation(comments, pr.head.sha)) pending.push(pr.number);
  }
  return pending;
}

const main = async () => {
  const args = process.argv.slice(2);
  const watchArg = args.find((a) => a === '--watch' || a.startsWith('--watch='));
  const watchIdx = args.indexOf('--watch');
  // --watch=10 | --watch 10 | --watch (default 5). Valores <= 0 → default.
  const watchMin = watchArg
    ? Math.max(1, Number(watchArg.split('=')[1] ?? args[watchIdx + 1]) || 5)
    : 0;
  const prNumber = Number(args[0]);

  if (!config.githubToken) {
    console.error('GITHUB_TOKEN requerido en .env');
    process.exit(1);
  }
  if (watchArg && prNumber) {
    console.error('uso: npm run validate:pr -- [<numero> | --watch [minutos]]');
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

  if (prNumber) {
    const ok = await validateOnePR({ prNumber, owner, repo });
    process.exit(ok ? 0 : 1);
  }

  // Modo automático: validar todos los PRs abiertos pendientes, una y
  // otra vez si se pasó --watch (polling cada N minutos, default 5).
  for (;;) {
    let pending;
    try {
      pending = await listPendingPRs(owner, repo);
    } catch (err) {
      // Error transitorio de la API (rate limit, red) — en modo watch
      // no debe abortar el loop.
      console.error(`⚠ listando PRs: ${err.message}`);
      pending = null;
    }
    if (pending === null) {
      /* reintentar en la próxima pasada */
    } else if (pending.length === 0) {
      console.log(`✔ sin PRs pendientes de validación`);
    } else {
      console.log(`PRs pendientes: ${pending.map((n) => `#${n}`).join(', ')}`);
      for (const n of pending) {
        try {
          await validateOnePR({ prNumber: n, owner, repo });
        } catch (err) {
          console.error(`PR #${n}: validación abortada — ${err.message}`);
        }
      }
    }
    if (!watchMin) break;
    console.log(`\n⏳ próxima pasada en ${watchMin} min (Ctrl+C para salir)`);
    await sleep(watchMin * 60_000);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
