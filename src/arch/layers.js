/**
 * Patrón por capas: routes → controllers → services (lógica pura) →
 * repositories (acceso a datos). La lógica vive en services.
 */
export default {
  id: 'layers',
  label: 'por capas (controllers/services/repositories)',
  instructions:
    'Arquitectura LAYERS (por capas): server/routes/<name>.js fino (solo mapea HTTP → controller) → ' +
    'server/controllers/<entity>.js (parsea request, devuelve status+JSON) → ' +
    'server/services/<entity>.js (toda la lógica de negocio, PURA — no importa express) → ' +
    'server/repositories/<entity>.js (queries SQLite via server/db.js). ' +
    'Cada capa solo llama a la inmediata inferior; no saltar capas ni poner queries en controllers.',
  agentsRules:
    '**Arquitectura por capas**: `server/routes/` → `server/controllers/` (request/response) → ' +
    '`server/services/` (lógica de negocio pura, sin Express) → `server/repositories/` ' +
    '(queries SQLite via `server/db.js`). Cada capa solo llama a la inmediata inferior — ' +
    'al agregar endpoints respetar esa dirección.',
  // Variante python (fastapi): routers → controllers → services puras
  // → repositories, mismas direcciones de dependencia sobre app/.
  instructionsFastapi:
    'Arquitectura LAYERS (por capas): app/routers/<name>.py fino (solo mapea HTTP → controller) → ' +
    'app/controllers/<entity>.py (parsea request, devuelve status+JSON) → ' +
    'app/services/<entity>.py (toda la lógica de negocio, PURA — no importa fastapi) → ' +
    'app/repositories/<entity>.py (queries via app/db.py). ' +
    'Cada capa solo llama a la inmediata inferior; no saltar capas ni poner queries en controllers.',
  agentsRulesFastapi:
    '**Arquitectura por capas**: `app/routers/` → `app/controllers/` (request/response) → ' +
    '`app/services/` (lógica de negocio pura, sin FastAPI) → `app/repositories/` ' +
    '(queries via `app/db.py`). Cada capa solo llama a la inmediata inferior — ' +
    'al agregar endpoints respetar esa dirección.',
};
