/**
 * Stack backend: Express 5 + SQLite (better-sqlite3) + multer + dotenv.
 * Definición declarativa — validator, preflight, finalizer y los
 * prompts del planner leen de acá. Agregar un stack backend nuevo =
 * un archivo así + registro en src/stacks/index.js.
 */
import { pkgDeps } from './helpers.js';

export default {
  id: 'express-sqlite',
  kind: 'backend',
  label: 'Express + SQLite',
  agentsStack: 'Node.js + Express',
  agentsDb: 'SQLite (archivo local, sin servidores externos)',
  skeletonDir: 'api-skeleton',

  toolchain: {
    manifest: 'package.json',
    installCmd: 'npm install',
    testCmd: 'npx vitest run',
    devCmd: 'npm run api',
    devPort: 4000,
    dockerfile: 'backend',
    markers: ['server'],
  },

  // nest-typeorm se evalúa primero (trae `mongodb` como dep — si mongo
  // se chequeara antes, una app nest se detectaría como express-mongo).
  detectPriority: 20,
  detect: (dir) => Boolean(pkgDeps(dir)['better-sqlite3']),

  // Mismo modelo que vite-react: `error` para validatePlan,
  // `prompt` para los bullets del planner.
  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['express'],
      error: 'falta paso de Express',
      prompt:
        'Si incluye backend: Express en `server/` — el api-skeleton ya está instalado; el paso personaliza schema/seed/routes, no scaffold desde cero.',
    },
    {
      check: 'some',
      type: null,
      keywords: ['sqlite'],
      error: 'falta paso de SQLite',
      prompt:
        'La capa de datos es SQLite (better-sqlite3) vía `server/schema.sql` + `server/seed-data.js`.',
    },
    {
      check: 'some',
      type: 'test',
      keywords: ['vitest'],
      error: 'falta paso test con Vitest',
      prompt:
        'Al menos un paso `type: "test"` que configure Vitest con verify `npx vitest run` o `npm test`.',
    },
  ],

  readme: {
    stack: '- Node.js + Express + SQLite (backend)',
    e2eSuffix: '',
    dev: 'npm run api        # API Express en http://localhost:4000',
    tests: [],
  },
};
