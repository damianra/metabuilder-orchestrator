/**
 * Stack backend: Express 5 + PostgreSQL (driver `pg`) + multer + dotenv.
 * Mismo api-skeleton-sql que express-mysql — difiere el driver default
 * (DB_DRIVER=pg) y el dialecto que documenta agentsStack/requirements.
 * Agregar un stack = este archivo + registro en src/stacks/index.js.
 */
export default {
  id: 'express-postgres',
  kind: 'backend',
  label: 'Express + PostgreSQL',
  skeletonDir: 'api-skeleton-sql',

  verify: {
    test: 'npx vitest run',
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
      keywords: ['postgres'],
      error: 'falta paso de PostgreSQL',
      prompt:
        'La capa de datos es PostgreSQL vía `DB_DRIVER=pg` en .env — `server/db.js` da pool + `q()` con placeholders `?` (traducidos a $1..$n) + schema DDL idempotente por driver + `seed-data.js`.',
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
    stack: '- Node.js + Express + PostgreSQL (backend)',
    e2eSuffix: '',
    dev: 'npm run api        # API Express en http://localhost:4000 (requiere DB_* en .env)',
    tests: [],
  },
};
