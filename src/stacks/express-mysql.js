/**
 * Stack backend: Express 5 + MySQL/MariaDB (driver `mysql2`) + multer +
 * dotenv. Mismo api-skeleton-sql que express-postgres — difiere el
 * driver default (DB_DRIVER=mysql) y el dialecto documentado.
 */
export default {
  id: 'express-mysql',
  kind: 'backend',
  label: 'Express + MySQL',
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
