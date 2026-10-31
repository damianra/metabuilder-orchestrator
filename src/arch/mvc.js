/**
 * Patrón MVC clásico: routes finos → controllers → models (fat models
 * con la lógica de negocio y las queries). Sin capa de services.
 */
export default {
  id: 'mvc',
  label: 'MVC clásico',
  instructions:
    'Arquitectura MVC: server/routes/<name>.js queda fino — solo mapea método/path a un ' +
    'controller (el auto-mount lo exige). server/controllers/<entity>.js orquesta ' +
    'request → model → response (parsea, valida, devuelve status+JSON). ' +
    'server/models/<entity>.js contiene TODA la lógica de negocio y las queries SQLite ' +
    '(fat models via server/db.js). NO crear services ni repositories.',
  agentsRules:
    '**Arquitectura MVC**: `server/routes/*.js` solo mapean HTTP → `server/controllers/`; ' +
    'los controllers orquestan request/response y delegan a `server/models/` (fat models ' +
    'con toda la lógica de negocio y las queries SQLite via `server/db.js`). ' +
    'Al agregar endpoints: route fino + método en controller + lógica en model.',
  // Variante python (fastapi): routers finos + controllers + fat models
  // — la lógica/queries viven en app/models.py (o app/models/ por entidad).
  instructionsFastapi:
    'Arquitectura MVC: app/routers/<name>.py queda fino — solo mapea método/path a un ' +
    'controller (el auto-mount lo exige). app/controllers/<entity>.py orquesta ' +
    'request → model → response (parsea, valida, devuelve status+JSON). ' +
    'app/models.py contiene TODA la lógica de negocio y las queries (fat models via app/db.py). ' +
    'NO crear services ni repositories.',
  agentsRulesFastapi:
    '**Arquitectura MVC**: `app/routers/*.py` solo mapean HTTP → `app/controllers/`; ' +
    'los controllers orquestan request/response y delegan a `app/models.py` (fat models ' +
    'con la lógica de negocio y las queries via `app/db.py`). ' +
    'Al agregar endpoints: router fino + función en controller + lógica en models.',
};
