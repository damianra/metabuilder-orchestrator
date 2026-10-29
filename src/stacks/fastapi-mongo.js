/**
 * Stack backend: FastAPI + MongoDB (Python 3.12) — variante mongo del
 * stack fastapi (v13 #2). ODMantic sobre Motor (async): los models son
 * pydantic y van directo como response_model — sin schemas.py. Mismas
 * env vars que express-mongo (MONGO_URI/MONGO_DB), mismo toolchain
 * python (pip/pytest/uvicorn) y mismos Dockerfiles que `fastapi`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'fastapi-mongo',
  kind: 'backend',
  label: 'FastAPI + MongoDB',
  skeletonDir: 'fastapi-skeleton-mongo',
  agentsStack: 'Python + FastAPI',
  agentsDb: 'MongoDB via ODMantic/Motor (async) — MONGO_URI/MONGO_DB en .env, schemaless, seed por engine.count',
  agentsNotes: `- **Backend**: cada \`app/routers/<name>.py\` con \`APIRouter\` se auto-monta en \`/api/<name>\` — no tocar \`app/main.py\` ni \`app/db.py\`. Models ODMantic en \`app/models.py\` (\`response_model\` directo — el Model ya es pydantic).
- **Capa de datos**: Motor async — \`app/db.py\` con \`MONGO_URI\`/\`MONGO_DB\` en \`.env\` (schemaless); seed por \`engine.count\` en \`init_db\`. Tests con mongomock (sin mongo real).
- **Sin uploads en el skeleton** — agregar como endpoint propio si hacen falta.
- **Secretos/config**: \`.env\` (gitignored) — \`python-dotenv\` ya cargado en \`app/main.py\`. Declarar toda variable en \`.env.example\`.
- **Docker**: los provee el orquestador — el contenedor corre \`uvicorn app.main:app\` (el backend sirve \`dist/\` si existe).`,
  apiSurface: 'fastapi-routes',
  framework: 'fastapi',
  dbs: ['mongo'],

  toolchain: {
    manifest: 'requirements.txt',
    installCmd: 'pip install -r requirements.txt',
    testCmd: 'python -m pytest',
    testLabel: 'pytest',
    devCmd: 'uvicorn app.main:app --port 4000',
    devPort: 4000,
    dockerfile: 'python',
    dockerfileFullstack: 'fullstack-python',
    markers: ['app/main.py'],
  },

  // Prioridad MAYOR que fastapi (14 < 15): un dir fastapi-mongo también
  // matchea el detect de `fastapi` (app/main.py + 'fastapi' en
  // requirements) — el específico por odmantic/motor gana primero,
  // mismo patrón nest-vs-mongo.
  detectPriority: 14,
  detect: (dir) => {
    if (!existsSync(join(dir, 'requirements.txt'))) return false;
    try {
      return /odmantic|motor/i.test(readFileSync(join(dir, 'requirements.txt'), 'utf8'));
    } catch {
      return false;
    }
  },

  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['fastapi'],
      error: 'falta paso de FastAPI',
      prompt:
        'Si incluye backend: FastAPI en `app/` — el fastapi-skeleton-mongo ya está instalado (auto-mount de `app/routers/<name>.py` en `/api/<name>`); el paso personaliza models/seed/routers, no scaffold desde cero.',
    },
    {
      check: 'some',
      type: null,
      keywords: ['mongo'],
      error: 'falta paso de MongoDB',
      prompt:
        'La capa de datos es MongoDB vía ODMantic/Motor async — `app/db.py` arma client/engine por `MONGO_URI`/`MONGO_DB` en .env, `app/models.py` los Model (pydantic, van directo de response_model) y `app/seed.py` el seed idempotente (solo si la colección está vacía).',
    },
    {
      check: 'some',
      type: 'test',
      keywords: ['pytest'],
      error: 'falta paso test con pytest',
      prompt: 'Al menos un paso `type: "test"` que configure pytest con verify `python -m pytest` (los tests usan mongomock — no exigen mongo real).',
    },
  ],

  readme: {
    stack: '- Python + FastAPI + MongoDB (ODMantic/Motor) (backend)',
    e2eSuffix: '',
    dev: 'uvicorn app.main:app --port 4000   # API FastAPI en http://localhost:4000 (requiere MONGO_URI en .env)',
    tests: [],
  },
};
