/**
 * Stack backend: Express 5 + MySQL/MariaDB (driver `mysql2`) + multer +
 * dotenv. Mismo api-skeleton-sql que express-postgres — difiere el
 * driver default (DB_DRIVER=mysql) y el dialecto documentado.
 */
import { AGENTS_NOTES_EXPRESS_SQL, envValue, pkgDeps } from './helpers.js';

export default {
  id: 'express-mysql',
  kind: 'backend',
  label: 'Express + MySQL',
  agentsStack: 'Node.js + Express',
  agentsDb: 'MySQL/MariaDB (vía DB_* en .env)',
  skeletonDir: 'api-skeleton-sql',
  framework: 'express',
  dbs: ['mysql'],

  toolchain: {
    manifest: 'package.json',
    installCmd: 'npm install',
    testCmd: 'npx vitest run',
    devCmd: 'npm run api',
    devPort: 4000,
    dockerfile: 'backend',
    markers: ['server'],
  },

  // pg|mysql2 con DB_DRIVER=mysql explícito → mysql (postgres es el
  // fallback del skeleton-sql, se evalúa después).
  detectPriority: 40,
  detect: (dir) => {
    const deps = pkgDeps(dir);
    return Boolean(deps.pg || deps.mysql2) && envValue(dir, 'DB_DRIVER') === 'mysql';
  },

  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['express'],
      error: 'falta paso de Express',
      prompt:
        'Si incluye backend: Express en `server/` — el api-skeleton-sql ya está instalado; el paso personaliza schema/seed/routes, no scaffold desde cero.',
    },
    {
      check: 'some',
      type: null,
      keywords: ['mysql'],
      error: 'falta paso de MySQL',
      prompt:
        'La capa de datos es MySQL/MariaDB vía `DB_DRIVER=mysql` en .env — `server/db.js` da pool + `q()` con placeholders `?` nativos + schema DDL idempotente por driver + `seed-data.js`.',
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
    stack: '- Node.js + Express + MySQL (backend)',
    e2eSuffix: '',
    dev: 'npm run api        # API Express en http://localhost:4000 (requiere DB_* en .env)',
    tests: [],
  },
};
