/**
 * Stack backend: NestJS 10 + TypeORM (TypeScript) — un solo skeleton
 * cubre postgres/mysql/mongodb via DB_TYPE en .env (DataSource por
 * driver). Convención: recurso = entity + service + controller +
 * módulo; controllers se escanean para api-surface (nest-controllers).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pkgDeps } from './helpers.js';

export default {
  id: 'nest-typeorm',
  kind: 'backend',
  label: 'NestJS + TypeORM',
  skeletonDir: 'nest-skeleton',
  framework: 'nest',
  dbs: ['postgres', 'mysql', 'mongo'],
  agentsStack: 'Node.js + NestJS (TypeScript, decorators + DI)',
  agentsDb: 'TypeORM con DataSource por DB_TYPE (postgres|mysql|mongodb) en .env — entities TypeORM (mongo via @ObjectIdColumn), synchronize en dev',
  apiSurface: 'nest-controllers',

  toolchain: {
    manifest: 'package.json',
    installCmd: 'npm install',
    testCmd: 'npx vitest run',
    devCmd: 'npm run api',
    devPort: 4000,
    // Backend TS: build stage tsc → Dockerfile.backend-ts;
    // fullstack-ts para apps con front (vite dist/ + tsc dist-server/).
    dockerfile: 'backend-ts',
    dockerfileFullstack: 'fullstack-ts',
    markers: ['nest-cli.json'],
  },

  // Primero entre los backend: trae `mongodb` como dep y le ganaría a
  // express-mongo/mongo si se evaluara después.
  detectPriority: 10,
  detect: (dir) => Boolean(pkgDeps(dir)['@nestjs/core']) || existsSync(join(dir, 'nest-cli.json')),

  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['nestjs'],
      error: 'falta paso de NestJS',
      prompt:
        'Si incluye backend: NestJS en `server/` — el nest-skeleton ya está instalado (TypeORM + items CRUD de muestra); el paso agrega entities/services/controllers, no scaffold desde cero.',
    },
    {
      check: 'some',
      type: null,
      keywords: ['typeorm'],
      error: 'falta paso de TypeORM',
      prompt:
        'La capa de datos es TypeORM con `DB_TYPE=postgres|mysql|mongodb` en .env — `server/database.module.ts` arma el DataSource; agregar entidades al array `entities` + registrar el módulo.',
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
    stack: '- Node.js + NestJS + TypeORM (backend)',
    e2eSuffix: '',
    dev: 'npm run api        # API NestJS en http://localhost:4000 (requiere DB_TYPE/DB_* en .env)',
    tests: [],
  },
};
