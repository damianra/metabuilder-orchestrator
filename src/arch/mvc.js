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
};
