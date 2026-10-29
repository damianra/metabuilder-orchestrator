/**
 * Stack backend: FastAPI + SQLAlchemy (Python 3.12) — primer stack
 * no-Node. Su toolchain declara pip/pytest/uvicorn y manifest
 * requirements.txt; el pipeline (install, verify, dev-run, Docker)
 * lo lee sin tocar npm. DB via DATABASE_URL (sqlite local default;
 * postgres/mysql por URL + driver pip). Auto-mount: cada
 * app/routers/<name>.py con `router` → /api/<name>.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'fastapi',
  kind: 'backend',
  label: 'FastAPI + SQLAlchemy',
  skeletonDir: 'fastapi-skeleton',
  framework: 'fastapi',
  dbs: ['sqlite', 'postgres', 'mysql'],
  agentsStack: 'Python + FastAPI',
  agentsDb:
    'SQLAlchemy via DATABASE_URL en .env (sqlite local default; postgres/mysql por URL + driver pip)',
  agentsNotes: `- **Backend**: cada \`app/routers/<name>.py\` con \`APIRouter\` se auto-monta en \`/api/<name>\` — no tocar \`app/main.py\` ni \`app/db.py\`. Models SQLAlchemy en \`app/models.py\`, schemas pydantic en \`app/schemas.py\`.
- **Capa de datos**: \`app/db.py\` con \`DATABASE_URL\` (sqlite por default — postgres/mysql via env); seed idempotente en \`init_db\`.
- **Sin uploads en el skeleton** — agregar como endpoint propio si hacen falta.
- **Secretos/config**: \`.env\` (gitignored) — \`python-dotenv\` ya cargado en \`app/main.py\`. Declarar toda variable en \`.env.example\`.
- **Docker**: los provee el orquestador — el contenedor corre \`uvicorn app.main:app\` (el backend sirve \`dist/\` si existe).`,
  apiSurface: 'fastapi-routes',

  toolchain: {
    manifest: 'requirements.txt',
    installCmd: 'pip install -r requirements.txt',
    testCmd: 'python -m pytest',
    testLabel: 'pytest',
    devCmd: 'uvicorn app.main:app --port 4000',
    devPort: 4000,
    dockerfile: 'python',
    // Con frontend, el runtime no puede ser node — fullstack-python
    // (build del front en stage node + uvicorn sirviendo dist/out).
    dockerfileFullstack: 'fullstack-python',
    markers: ['app/main.py'],
  },

  // Detección por archivo propio o contenido del manifest — no por
  // deps de package.json como los stacks node. Tras nest (10): un dir
  // fastapi no pisa los detects de los demás de todos modos.
  detectPriority: 15,
  detect: (dir) => {
    if (existsSync(join(dir, 'app', 'main.py'))) return true;
    try {
      return /fastapi/i.test(readFileSync(join(dir, 'requirements.txt'), 'utf8'));
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
        'Si incluye backend: FastAPI en `app/` — el fastapi-skeleton ya está instalado (auto-mount de `app/routers/<name>.py` en `/api/<name>`); el paso personaliza models/seed/routers, no scaffold desde cero. El recurso `items` del skeleton es de MUESTRA: reemplazarlo por el recurso real del dominio (rename/refactor completo) o eliminarlo entero si el dominio no tiene CRUD análogo — `/api/items` no debe quedar en la app final.',
    },
    {
      check: 'some',
      type: null,
      keywords: ['sqlalchemy'],
      error: 'falta paso de SQLAlchemy',
      prompt:
        'La capa de datos es SQLAlchemy vía `DATABASE_URL` en .env — `app/db.py` arma engine/session/Base, `app/models.py` las entities y `app/seed.py` el seed idempotente (solo si la tabla está vacía).',
    },
    {
      check: 'some',
      type: 'test',
      keywords: ['pytest'],
      error: 'falta paso test con pytest',
      prompt: 'Al menos un paso `type: "test"` que configure pytest con verify `python -m pytest`.',
    },
  ],

  readme: {
    stack: '- Python + FastAPI + SQLAlchemy (backend)',
    e2eSuffix: '',
    dev: 'uvicorn app.main:app --port 4000   # API FastAPI en http://localhost:4000',
    tests: [],
  },
};
