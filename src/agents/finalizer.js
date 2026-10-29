import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { run } from '../tools/shell.js';
import { awaitInstall, isInstalling } from '../tools/install.js';
import { finalCheckCommands, stacksFor } from '../stacks/index.js';
import { getGitHubUser, createRepo, enablePages, getPages } from '../tools/github.js';
import { captureScreenshot } from '../tools/screenshot.js';
import { getEngine } from '../engines/index.js';
import { activity, log, loadTemplate } from './common.js';

// Nunca loguear el token: sanitiza cualquier salida que pueda contenerlo.
export const sanitize = (s, token = config.githubToken) =>
  token ? String(s).replaceAll(token, '***') : String(s);

// GitHub HTTPS no acepta "Bearer" en http.extraHeader para git —
// necesita Basic base64(x-access-token:TOKEN), y el header debe
// matchear el host para que git lo use sin pedir credenciales.
export const ghAuthArgs = (token = config.githubToken) =>
  token
    ? `-c http.https://github.com.extraHeader="Authorization: Basic ${
        Buffer.from(`x-access-token:${token}`).toString('base64')
      }"`
    : '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST /pages puede dar 5xx transitorio justo después del push de
// gh-pages (GitHub provisiona async). Reintenta solo ante 500/502/503 —
// un 409 "already enabled" no se reintenta: cae directo al GET de
// confirmación en el caller.
export async function enablePagesWithRetry(
  token,
  owner,
  repo,
  { retries = 3, delayMs = 4000, enable = enablePages } = {},
) {
  for (let i = 0; ; i++) {
    try {
      return await enable(token, owner, repo);
    } catch (e) {
      if (![500, 502, 503].includes(e.status) || i >= retries) throw e;
      await sleep(delayMs);
    }
  }
}

/**
 * Batería de verificación final sobre el proyecto terminado.
 * frontend/fullstack: build + vitest + e2e. backend: vitest.
 * Un fallo → lastError → loop fix (finalRetries) → fail.
 */
export async function finalVerifyNode(state) {
  if (isInstalling(state.projectDir)) activity('esperando install de dependencias…');
  const install = await awaitInstall(state.projectDir);
  if (!install.ok) {
    return {
      verifying: 'final',
      lastError: `install del proyecto falló: ${install.stderr.slice(-500)}`,
      history: [log('finalVerify', 'FAIL: install del proyecto')],
    };
  }

  const cmds = finalCheckCommands(stacksFor(state));

  for (const cmd of cmds) {
    const res = await run(cmd, { cwd: state.projectDir, timeoutMs: config.verifyTimeoutMs });
    if (!res.ok) {
      return {
        verifying: 'final',
        lastError: `finalVerify "${cmd}" falló (exit ${res.exitCode ?? 'timeout'})`,
        lastOutput: (res.stdout + '\n' + res.stderr).slice(-4000),
        history: [log('finalVerify', `FAIL: ${cmd}`)],
      };
    }
  }

  const history = [log('finalVerify', `OK: ${cmds.join(' && ')}`)];

  // --verify-docker: build de la imagen como check extra. Sin daemon
  // se omite (es un flag opt-in, no debe fallar el run por ambiente).
  if (state.verifyDocker) {
    // docker primero, podman como fallback — CLI-compatible, igual que
    // el probe del dashboard (antes era docker-only).
    let engine = null;
    if ((await run('docker info', { cwd: state.projectDir, timeoutMs: 15_000 })).ok) engine = 'docker';
    else if ((await run('podman info', { cwd: state.projectDir, timeoutMs: 15_000 })).ok) engine = 'podman';
    if (!engine) {
      history.push(log('finalVerify', 'sin engine de containers — verify-docker omitido'));
    } else {
      const tag = `${state.projectSlug || 'app'}:verify`;
      const build = await run(`${engine} build -t ${tag} .`, {
        cwd: state.projectDir,
        timeoutMs: config.verifyTimeoutMs * 3,
      });
      if (!build.ok) {
        return {
          verifying: 'final',
          lastError: `finalVerify "docker build" falló (exit ${build.exitCode ?? 'timeout'})`,
          lastOutput: (build.stdout + '\n' + build.stderr).slice(-4000),
          history: [log('finalVerify', 'FAIL: docker build')],
        };
      }
      history.push(log('finalVerify', `${engine} build OK (${tag})`));
    }
  }

  return {
    verifying: 'final',
    lastError: null,
    status: 'verified',
    history,
  };
}

/**
 * git init + commit en la app generada. Push si:
 * - GITHUB_REPO_URL configurada (repo pre-creado, SSH/HTTPS), o
 * - --github + GITHUB_TOKEN: crea el repo via REST. Si además viene
 *   --ghpages (y hay frontend), publica dist/ en gh-pages y activa Pages.
 */
/**
 * README.md determinístico (descripción + cómo levantar el proyecto +
 * crédito a MetaBuilder). Se escribe justo antes del commit para que
 * refleje el scope final, sin depender del agente.
 */
export function writeReadme(state, { screenshot = null } = {}) {
  const { frontend, backend } = stacksFor(state);

  const stack = [
    frontend?.readme.stack,
    backend?.readme.stack,
    `- Vitest (tests)${frontend?.readme.e2eSuffix ?? ''}`,
  ].filter(Boolean).join('\n');

  const devCommands = [frontend?.readme.dev, backend?.readme.dev].filter(Boolean).join('\n');

  // Comandos de test del README: el testCmd de cada toolchain activo
  // (dedup — los stacks node comparten 'npx vitest run') + los extras
  // declarados en readme.tests (p.ej. e2e Playwright del frontend).
  const testCommands = [
    ...[...new Set(
      [frontend, backend]
        .map((s) => s?.toolchain?.testCmd)
        .filter(Boolean)
        .map((c) => `${c}   # tests`),
    )],
    ...(frontend?.readme.tests ?? []),
  ].join('\n');

  // Crédito del engine real usado (state.agent lo resolvió preflight a
  // un id concreto; 'auto'/vacío no debería llegar acá — fallback
  // genérico por las dudas).
  let engine = 'un motor ACP';
  try {
    const e = state.agent && state.agent !== 'auto' ? getEngine(state.agent) : null;
    if (e) engine = e.label;
  } catch {
    /* id desconocido → crédito genérico */
  }

  const md = loadTemplate('README.md', {
    name: state.projectSlug,
    idea: state.idea,
    stack,
    devCommands,
    testCommands,
    engine,
    screenshot: screenshot ? `## Captura\n\n![Captura de la app](${screenshot})\n` : '',
  });
  writeFileSync(join(state.projectDir, 'README.md'), md);
}

export async function finalizerNode(state) {
  const dir = state.projectDir;
  const history = [];

  const hasFrontend = state.scope !== 'backend';
  const frontendStack = stacksFor(state).frontend;
  // buildDir del stack: 'dist' (Vite) / 'out' (Next export).
  const outDir = join(dir, frontendStack?.buildDir ?? 'dist');

  // Screenshot del build para el README — siempre que el scope tenga
  // frontend y el build exista (la imagen queda commiteada con el
  // proyecto; la referencia es relativa, anda igual sin github).
  // Warn-only: sin playwright/chromium el README sale sin imagen.
  let screenshot = null;
  if (hasFrontend && existsSync(outDir)) {
    const shot = await captureScreenshot({
      dir: outDir,
      cwd: dir,
      outFile: join(dir, 'screenshot.png'),
    });
    if (shot.ok && existsSync(join(dir, 'screenshot.png'))) {
      screenshot = 'screenshot.png';
      history.push(log('finalize', 'screenshot.png capturado'));
    } else {
      history.push(
        log('finalize', `screenshot omitido: ${(shot.stderr || 'falló').slice(-160)}`),
      );
    }
  }

  writeReadme(state, { screenshot });
  history.push(log('finalize', 'README.md generado'));

  const git = (args, cwd = dir) =>
    run(`git ${args}`, { cwd, timeoutMs: 120_000 }).then((r) => ({
      ...r,
      stderr: sanitize(r.stderr),
      stdout: sanitize(r.stdout),
    }));

  for (const cmd of [
    'init -b main',
    `config user.name "${config.gitUserName}"`,
    `config user.email "${config.gitUserEmail}"`,
    'add -A',
  ]) {
    const r = await git(cmd);
    if (!r.ok) {
      return {
        status: 'failed',
        lastError: `git ${cmd.split(' ')[0]} falló: ${r.stderr.slice(-400)}`,
        history: [...history, log('finalize', `falló: git ${cmd.split(' ')[0]}`)],
      };
    }
  }
  // Commit inicial — puede no haber cambios si se re-corre (reutilizar).
  const staged = await git('diff --cached --quiet');
  if (!staged.ok) {
    const commit = await git('commit -m "Initial commit — generated by MetaBuilder"');
    if (!commit.ok) {
      return {
        status: 'failed',
        lastError: `git commit falló: ${commit.stderr.slice(-400)}`,
        history: [...history, log('finalize', 'git commit falló')],
      };
    }
    history.push(log('finalize', 'commit local creado'));
  } else {
    history.push(log('finalize', 'sin cambios nuevos — commit previo reutilizado'));
  }

  if (state.noPush) {
    return { status: 'done', history: [...history, log('finalize', '--no-push: solo commit local')] };
  }

  // --- Resolver remoto ---
  let remoteUrl = config.githubRepoUrl;
  let owner = null;
  let repoName = null;

  if (state.deployGithub) {
    if (!config.githubToken) {
      history.push(log('finalize', '--github sin GITHUB_TOKEN en .env — se omite creación de repo'));
    } else {
      try {
        const user = await getGitHubUser(config.githubToken);
        owner = user.login;
        repoName = state.projectSlug;
        try {
          await createRepo(
            config.githubToken,
            repoName,
            `${state.idea} — generado por MetaBuilder`,
          );
          history.push(log('finalize', `repo GitHub creado: ${owner}/${repoName}`));
        } catch (e) {
          if (e.status === 422) {
            history.push(log('finalize', `repo ${owner}/${repoName} ya existe — se reutiliza`));
          } else throw e;
        }
        remoteUrl = `https://github.com/${owner}/${repoName}.git`;
      } catch (e) {
        return {
          status: 'failed',
          lastError: `GitHub API: ${e.message}`,
          history: [...history, log('finalize', `GitHub API falló: ${e.message}`)],
        };
      }
    }
  }

  if (!remoteUrl) {
    return {
      status: 'done',
      history: [
        ...history,
        log('finalize', 'sin GITHUB_REPO_URL ni --github: solo commit local'),
      ],
    };
  }

  // --- Push main ---
  await git('remote remove origin'); // idempotente si no existe
  let r = await git(`remote add origin ${remoteUrl}`);
  if (!r.ok) {
    return {
      status: 'failed',
      lastError: `git remote falló: ${r.stderr.slice(-400)}`,
      history: [...history, log('finalize', 'git remote add falló')],
    };
  }
  r = await git(`${ghAuthArgs()} push -u origin main`);
  if (!r.ok) {
    return {
      status: 'failed',
      lastError: `git push falló: ${r.stderr.slice(-400)}`,
      history: [...history, log('finalize', 'push a main falló')],
    };
  }
  history.push(log('finalize', `push a ${remoteUrl} (main)`));

  // --- GitHub Pages (solo con --github + --ghpages + token + frontend) ---
  if (
    state.deployGithub &&
    state.deployPages &&
    config.githubToken &&
    hasFrontend &&
    existsSync(outDir)
  ) {
    // Stacks con pagesBaseEnv (Next): el basePath se hornea en el
    // build → re-build con PAGES_BASE=/<repo> antes de publicar.
    if (frontendStack?.pagesBaseEnv) {
      const rebuild = await run(
        `${frontendStack.pagesBaseEnv}=/${repoName} npm run build`,
        { cwd: dir, timeoutMs: config.verifyTimeoutMs },
      );
      if (!rebuild.ok) {
        history.push(
          log('finalize', `rebuild con ${frontendStack.pagesBaseEnv} falló — Pages omitido`),
        );
        return { status: 'done', history };
      }
      history.push(log('finalize', `rebuild con ${frontendStack.pagesBaseEnv}=/${repoName} OK`));
    }
    const pages = await deployPages(git, outDir, remoteUrl, owner, repoName);
    history.push(...pages.logs);
  } else if (state.deployPages && hasFrontend) {
    history.push(log('finalize', `sin ${frontendStack?.buildDir ?? 'dist'}/ o sin --github+token — Pages omitido`));
  }

  return { status: 'done', history };
}

export async function deployPages(
  git,
  distDir,
  remoteUrl,
  owner,
  repoName,
  { token = config.githubToken, enable = enablePagesWithRetry, read = getPages } = {},
) {
  const logs = [];
  for (const cmd of [
    'init -b gh-pages',
    `config user.name "${config.gitUserName}"`,
    `config user.email "${config.gitUserEmail}"`,
    'add -A',
    'commit -m "deploy: build para GitHub Pages"',
    `remote add origin ${remoteUrl}`,
  ]) {
    const r = await git(cmd, distDir);
    if (!r.ok) {
      logs.push(log('finalize', `gh-pages: falló git ${cmd.split(' ')[0]} — ${r.stderr.slice(-200)}`));
      return { logs, ok: false };
    }
  }
  const r = await git(`${ghAuthArgs(token)} push -f origin gh-pages`, distDir);
  if (!r.ok) {
    logs.push(log('finalize', `push gh-pages falló: ${r.stderr.slice(-200)}`));
    return { logs, ok: false };
  }
  const pagesUrl = `https://${owner}.github.io/${repoName}/`;
  try {
    const pages = await enable(token, owner, repoName);
    logs.push(
      log(
        'finalize',
        `GitHub Pages activo: ${pages.html_url ?? pagesUrl} ` +
          `(puede tardar unos minutos en estar visible)`,
      ),
    );
  } catch (e) {
    // El POST ya reintentó los 5xx transitorios: si llegó acá es un
    // 409 "already enabled" (el push suele auto-habilitarla) o un fallo
    // persistente — el GET confirma; la URL igual es válida.
    try {
      const pages = await read(token, owner, repoName);
      logs.push(
        log(
          'finalize',
          `GitHub Pages ya estaba activo: ${pages.html_url ?? pagesUrl} ` +
            `(puede tardar unos minutos en reflejar el último push)`,
        ),
      );
    } catch {
      logs.push(
        log(
          'finalize',
          `Pages API: ${e.message} — el push de gh-pages igual suele publicarla. ` +
            `Verificación manual: ${pagesUrl}`,
        ),
      );
    }
  }
  return { logs, ok: true };
}
