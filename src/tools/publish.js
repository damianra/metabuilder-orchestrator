// Publicación bajo demanda de una app ya generada — la misma
// secuencia que finalize --github [--ghpages] pero sin correr el
// pipeline: crea el repo via REST, pushea main, y opcionalmente
// publica el build en gh-pages + activa Pages. La usa el action
// `publish` del dashboard (botón GitHub del detalle).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { run } from './shell.js';
import { createRepo, getGitHubUser, getPages } from './github.js';
import { deployPages, enablePagesWithRetry, ghAuthArgs, sanitize } from '../agents/finalizer.js';

export async function publishRepo({
  dir,
  slug,
  ghpages = false,
  // Del stack frontend: dir de salida del build y env var de basePath
  // (Next la necesita horneada en el export; Vite usa base './' y no).
  buildDir = 'dist',
  pagesBaseEnv = null,
  token = config.githubToken,
  runCmd = run,
  github = { getUser: getGitHubUser, createRepo, enablePages: enablePagesWithRetry, getPages },
  userName = config.gitUserName,
  userEmail = config.gitUserEmail,
} = {}) {
  if (!token) throw new Error('sin GITHUB_TOKEN — declararlo en .env');

  const git = (args, cwd = dir) =>
    runCmd(`git ${args}`, { cwd, timeoutMs: 120_000 }).then((r) => ({
      ...r,
      stdout: sanitize(r.stdout, token),
      stderr: sanitize(r.stderr, token),
    }));
  const fail = (step, r) => {
    throw new Error(`${step}: ${(r.stderr || r.stdout || 'error').slice(-300)}`);
  };

  // Apps que murieron antes de finalize pueden no tener .git — el init
  // es idempotente (mismo patrón que finalizer).
  let r = await git('init -b main');
  if (!r.ok) fail('git init', r);

  // Commitea lo pendiente para que el remoto refleje el estado actual
  // (idempotente: `diff --cached --quiet` ok = tree limpio → sin commit).
  r = await git('add -A');
  if (!r.ok) fail('git add', r);
  r = await git('diff --cached --quiet');
  if (!r.ok) {
    r = await git(`config user.name "${userName}"`);
    if (!r.ok) fail('git config', r);
    r = await git(`config user.email "${userEmail}"`);
    if (!r.ok) fail('git config', r);
    r = await git('commit -m "chore: cambios pendientes — publish desde dashboard"');
    if (!r.ok) fail('git commit', r);
  }

  const owner = (await github.getUser(token)).login;
  try {
    await github.createRepo(token, slug, `${slug} — generado por MetaBuilder`);
  } catch (e) {
    if (e.status !== 422) throw e; // 422 = el repo ya existe → reutilizar
  }
  const remoteUrl = `https://github.com/${owner}/${slug}.git`;
  const hadRemote = (await git('remote get-url origin')).ok;
  await git('remote remove origin'); // idempotente si no existe
  r = await git(`remote add origin ${remoteUrl}`);
  if (!r.ok) fail('git remote', r);
  r = await git(`${ghAuthArgs(token)} push -u origin main`);
  if (!r.ok) {
    // Rollback del remote que acabamos de crear: si queda configurado,
    // la UI ve repoUrl y esconde el botón de publish → dead-end sin
    // camino de retry. Si el remote era preexistente se conserva.
    if (!hadRemote) await git('remote remove origin');
    fail('push main', r);
  }

  const out = { repoUrl: `https://github.com/${owner}/${slug}`, pagesUrl: null };
  if (ghpages) {
    // Build fresco antes de publicar (con basePath horneado si el
    // stack lo exige — Next export no soporta rewrites en Pages).
    const env = pagesBaseEnv ? `${pagesBaseEnv}=/${slug} ` : '';
    r = await runCmd(`${env}npm run build`, { cwd: dir, timeoutMs: 300_000 });
    if (!r.ok) fail('npm run build', r);
    const outDir = join(dir, buildDir);
    if (!existsSync(outDir)) throw new Error(`no existe ${buildDir}/ tras el build`);
    out.pagesLog = await deployPages(git, outDir, remoteUrl, owner, slug, {
      token,
      enable: github.enablePages,
      read: github.getPages,
    });
    out.pagesUrl = `https://${owner}.github.io/${slug}/`;
  }
  return out;
}
