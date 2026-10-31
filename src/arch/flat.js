/**
 * Patrón flat — el actual: cada server/routes/<name>.js concentra su
 * lógica (queries SQLite inline vía db.js). Default para apps chicas.
 */
export default {
  id: 'flat',
  label: 'flat (routes auto-montadas)',
  instructions:
    'Arquitectura FLAT: toda la lógica del endpoint vive en server/routes/<name>.js — ' +
    'queries SQLite inline via server/db.js, validación y respuesta en la misma route. ' +
    'Válido para APIs chicas; NO crear controllers/services/models ni capas extra.',
  agentsRules:
    'Toda la lógica del endpoint vive en `server/routes/<name>.js` (queries SQLite inline via `server/db.js`). ' +
    'Al agregar endpoints, mantener el mismo estilo — no crear controllers/services/models.',
  // Variante python (fastapi/fastapi-mongo): mismo patrón sobre el
  // layout app/ del skeleton — routers auto-montados, queries via db.py.
  instructionsFastapi:
    'Arquitectura FLAT: toda la lógica del endpoint vive en app/routers/<name>.py — ' +
    'queries inline via app/db.py (session SQLAlchemy / engine ODMantic), validación y respuesta en la misma route. ' +
    'Válido para APIs chicas; NO crear services/repositories ni capas extra.',
  agentsRulesFastapi:
    'Toda la lógica del endpoint vive en `app/routers/<name>.py` (queries via `app/db.py`). ' +
    'Al agregar endpoints, mantener el mismo estilo — no crear services/repositories ni capas extra.',
};
