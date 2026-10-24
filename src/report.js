// Reporte de un run — npm run report -- [<runId|slug>]
//
// runs/<runId>/prompts/*.rpc.jsonl guarda el JSON-RPC crudo de cada
// sesión Devin; esto lo resume en algo legible para iterar prompts y
// detectar patrones de fallo: pasos con sus intentos, duración por
// sesión (birthtime→mtime del log), prompts por sesión, totales.
// También escribe el resumen a runs/<runId>/report.md.
//
// Sin argumentos lista los runs recientes.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const fmtMs = (ms) => {
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return m ? `${m}m ${s}s` : `${s}s`;
};

const fmtBytes = (b) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

// runId = "<iso-ts>-<slug>" o "<iso-ts>-<slug>-resume" (resume runs).
export const slugFromRunId = (runId) =>
  runId.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-/, '').replace(/-resume$/, '');

// Reconstruye el timestamp de inicio desde el prefijo del runId
// (toISOString con : y . reemplazados por -). Para runs viejos cuyo
// status.json no tiene elapsedMs.
const tsFromRunId = (runId) => {
  const m = runId.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
};

// elapsedMs existe en runs nuevos; en viejos se deriva del timestamp
// del runId → status.ts (fin del run).
const elapsedFor = (status, runId) =>
  status?.elapsedMs ??
  (status?.ts && tsFromRunId(runId) ? Date.parse(status.ts) - tsFromRunId(runId) : null);

export function listRuns(runsDir = config.runsDir) {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((d) => statSync(join(runsDir, d)).isDirectory())
    .sort()
    .reverse();
}

// Resuelve arg → runId: dir exacto, o slug (el run más reciente que
// matchee *-<slug> / *-<slug>-resume).
export function resolveRunId(arg, runsDir = config.runsDir) {
  const runs = listRuns(runsDir);
  if (runs.includes(arg)) return arg;
  return runs.find((r) => slugFromRunId(r) === arg) ?? null;
}

// Un archivo por sesión Devin en prompts/. Duración ≈ birthtime→mtime
// (el stream se abre al crear la sesión y se cierra al terminar el
// prompt). Cuenta llamadas session/prompt en las líneas [client→].
export function collectSessions(runDir) {
  const dir = join(runDir, 'prompts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.rpc.jsonl'))
    .map((f) => {
      const path = join(dir, f);
      const st = statSync(path);
      const text = readFileSync(path, 'utf8');
      return {
        name: f.replace(/\.rpc\.jsonl$/, ''),
        bytes: st.size,
        prompts: (text.match(/"method":"session\/prompt"/g) ?? []).length,
        startedAt: st.birthtime,
        durationMs: Math.max(0, st.mtimeMs - st.birthtimeMs),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildReport({ runId, runDir, projectDir }) {
  const sessions = collectSessions(runDir);
  const status = projectDir ? readJson(join(projectDir, 'status.json')) : null;
  const plan = projectDir ? readJson(join(projectDir, 'plan.json')) : null;
  const steps = plan?.steps ?? [];
  const retries = steps.reduce((n, s) => n + (s.attempts ?? 0), 0);
  const fixSessions = sessions.filter((s) => s.name.startsWith('fix-')).length;
  const devinMs = sessions.reduce((n, s) => n + s.durationMs, 0);

  const lines = [`# Reporte de run — ${slugFromRunId(runId)}`, ''];
  lines.push(`- **runId**: \`${runId}\``);
  if (status) {
    const elapsed = elapsedFor(status, runId);
    lines.push(
      `- **status**: ${status.status}` +
        (elapsed != null ? ` · **duración total**: ${fmtMs(elapsed)}` : '') +
        (status.lastError ? ` · **error**: ${status.lastError}` : ''),
    );
  }
  if (plan) {
    lines.push(`- **app**: ${plan.projectName ?? '?'} · vertical=${plan.appType ?? '?'} · scope=${plan.scope ?? '?'}`);
  }
  if (projectDir) lines.push(`- **dir**: \`${projectDir}\``);
  lines.push('');

  if (steps.length) {
    lines.push(`## Pasos (${steps.length})`, '');
    lines.push('| # | tipo | status | intentos | verify |', '| --- | --- | --- | --- | --- |');
    for (const s of steps) {
      lines.push(`| ${s.id} | ${s.type} | ${s.status} | ${s.attempts ?? 0} | \`${s.verify}\` |`);
    }
    lines.push('');
  }

  lines.push(`## Sesiones Devin (${sessions.length})`, '');
  if (sessions.length) {
    lines.push('| sesión | duración | prompts | log |', '| --- | --- | --- | --- |');
    for (const s of sessions) {
      lines.push(`| ${s.name} | ${fmtMs(s.durationMs)} | ${s.prompts} | ${fmtBytes(s.bytes)} |`);
    }
    lines.push('');
  }
  lines.push(
    `**Totales**: ${fmtMs(devinMs)} en sesiones Devin · ` +
      `${retries} intento(s) de paso · ${fixSessions} sesión(es) de fix`,
  );
  return lines.join('\n') + '\n';
}

const main = async () => {
  const arg = process.argv[2];
  if (!arg) {
    const runs = listRuns();
    if (!runs.length) {
      console.log('sin runs en', config.runsDir);
      return;
    }
    console.log('runs recientes (npm run report -- <runId|slug> para el detalle):\n');
    for (const r of runs.slice(0, 15)) {
      const slug = slugFromRunId(r);
      const status = readJson(join(config.generatedAppsDir, slug, 'status.json'));
      const elapsed = elapsedFor(status, r);
      const info = status
        ? `${status.status}${elapsed != null ? ` · ${fmtMs(elapsed)}` : ''}`
        : 'sin status.json';
      console.log(`  ${r}   ${slug} — ${info}`);
    }
    return;
  }

  const runId = resolveRunId(arg);
  if (!runId) {
    console.error(`no encontré run "${arg}" en ${config.runsDir}`);
    process.exit(1);
  }
  const runDir = join(config.runsDir, runId);
  const projectDir = join(config.generatedAppsDir, slugFromRunId(runId));
  const report = buildReport({
    runId,
    runDir,
    projectDir: existsSync(projectDir) ? projectDir : null,
  });
  writeFileSync(join(runDir, 'report.md'), report);
  process.stdout.write(report);
  console.log(`\n→ guardado en ${join(runDir, 'report.md')}`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
