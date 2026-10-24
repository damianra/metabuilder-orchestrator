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
};
