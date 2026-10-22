import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function int(key, fallback) {
  const v = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

export const config = {
  rootDir: ROOT,
  generatedAppsDir: join(ROOT, 'generated-apps'),
  runsDir: join(ROOT, 'runs'),
  promptsDir: join(ROOT, 'src', 'prompts'),
  templatesDir: join(ROOT, 'src', 'templates'),

  // Credenciales del agente Devin (auth windsurf-api-key vía ACP)
  devinCredentialsPath:
    process.env.DEVIN_CREDENTIALS_PATH ??
    join(homedir(), '.local', 'share', 'devin', 'credentials.toml'),
  devinBin: process.env.DEVIN_BIN ?? 'devin',
  devinModel: process.env.DEVIN_MODEL || 'swe-2-high',
  devinMode: process.env.DEVIN_MODE || 'bypass',
  devinTimeoutMs: int('DEVIN_TIMEOUT_MS', 15 * 60 * 1000),

  // Reintentos
  maxStepRetries: int('MAX_STEP_RETRIES', 3),
  maxPlanRetries: int('MAX_PLAN_RETRIES', 2),

  // Git de la app generada
  githubRepoUrl: process.env.GITHUB_REPO_URL || '',
  // PAT con scope `repo` para crear repos + GitHub Pages via REST (--github)
  githubToken: process.env.GITHUB_TOKEN || '',
  gitUserName: process.env.GIT_USER_NAME || 'MetaBuilder',
  gitUserEmail: process.env.GIT_USER_EMAIL || 'metabuilder@localhost',

  // Timeout para comandos verify dentro de la app generada
  verifyTimeoutMs: int('VERIFY_TIMEOUT_MS', 5 * 60 * 1000),
};
