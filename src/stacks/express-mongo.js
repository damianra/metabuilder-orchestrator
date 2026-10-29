/**
 * Stack backend: Express 5 + MongoDB (driver nativo `mongodb`) +
 * multer + dotenv. Skeleton propio (`api-skeleton-mongo`) — document
 * store con `col(name)` y seed schemaless via `MONGO_URI`/`MONGO_DB`.
 */
import { AGENTS_NOTES_EXPRESS_MONGO, pkgDeps } from './helpers.js';

export default {
  id: 'express-mongo',
  kind: 'backend',
  label: 'Express + MongoDB',
  agentsStack: 'Node.js + Express',
  agentsDb: 'MongoDB (vía MONGO_URI en .env — document store)',
  skeletonDir: 'api-skeleton-mongo',
  agentsNotes: AGENTS_NOTES_EXPRESS_MONGO,
  framework: 'express',
  dbs: ['mongo'],

  toolchain: {
    manifest: 'package.json',
    installCmd: 'npm install',
    testCmd: 'npx vitest run',
    devCmd: 'npm run api',
    devPort: 4000,
    dockerfile: 'backend',
    markers: ['server'],
  },

  // Después de nest-typeorm: el nest-skeleton trae `mongodb` como dep
  // (TypeORM mongo) — sin la prioridad una app nest caería acá.
  detectPriority: 30,
  detect: (dir) => Boolean(pkgDeps(dir).mongodb),

  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['express'],
      error: 'falta paso de Express',
      prompt:
        'Si incluye backend: Express en `server/` — el api-skeleton-mongo ya está instalado; el paso personaliza colecciones/seed/routes, no scaffold desde cero. El recurso `items` del skeleton es de MUESTRA: reemplazarlo por el recurso real del dominio (rename/refactor completo) o eliminarlo entero si el dominio no tiene CRUD análogo — `/api/items` no debe quedar en la app final.',
    },
    {
      check: 'some',
      type: null,
      keywords: ['mongodb'],
      error: 'falta paso de MongoDB',
      prompt:
        'La capa de datos es MongoDB vía `MONGO_URI`/`MONGO_DB` en .env — `server/db.js` da `col(name)` del driver nativo + `seed-data.js` por colección (sin schema, schemaless).',
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
    stack: '- Node.js + Express + MongoDB (backend)',
    e2eSuffix: '',
    dev: 'npm run api        # API Express en http://localhost:4000 (requiere MONGO_URI en .env)',
    tests: [],
  },
};
