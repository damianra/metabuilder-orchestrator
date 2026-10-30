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

  // Engine de agente por defecto (src/engines/): '' → 'auto' (devin si
  // autentica, sino opencode — la sonda vive en preflight). --agent,
  // settings.json tiene precedencia sobre esta env; ésta a su vez sobre plan.agent.
  agentProvider: process.env.AGENT_PROVIDER || '',
  // Config mutable en runtime (hoy: { engine }) — la escribe el
  // dashboard via POST /api/settings y se relee en cada resolución.
  settingsPath:
    process.env.METABUILDER_SETTINGS_PATH ?? join(ROOT, 'settings.json'),

  // Credenciales del agente Devin (auth windsurf-api-key vía ACP)
  devinCredentialsPath:
    process.env.DEVIN_CREDENTIALS_PATH ??
    join(homedir(), '.local', 'share', 'devin', 'credentials.toml'),
  devinBin: process.env.DEVIN_BIN ?? 'devin',
  devinModel: process.env.DEVIN_MODEL || 'swe-2-high',
  devinMode: process.env.DEVIN_MODE || 'bypass',
  devinTimeoutMs: int('DEVIN_TIMEOUT_MS', 15 * 60 * 1000),

  // Engine OpenCode (`opencode acp`): sin authenticate — usa los
  // providers de `opencode auth login`. Model vacío = default del
  // provider (formato `provider/model`, ej. anthropic/claude-sonnet-4).
  opencodeBin: process.env.OPENCODE_BIN ?? 'opencode',
  opencodeModel: process.env.OPENCODE_MODEL || '',
  // Semáforo global de sesiones Devin entre procesos (slots en
  // ~/.metabuilder/devin-slots/). 1 = nunca más de una sesión a la vez
  // en toda la máquina, aunque haya varios `npm start` corriendo.
  maxDevinSessions: int('MAX_CONCURRENT_DEVIN_SESSIONS', 1),

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

  // Idle-parking del preview de diseño: tras este tiempo sin actividad
  // (el poll de GET /api/design cuenta — tab abierta = alguien mirando)
  // el sweeper del dashboard frena el vite dev de design-work/.
  designIdleMs: int('DESIGN_IDLE_MS', 15 * 60 * 1000),
};
