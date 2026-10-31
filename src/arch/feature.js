/**
 * Patrón por feature: el código se agrupa por entidad en módulos
 * autocontenidos; las routes quedan como punto de montaje fino.
 */
export default {
  id: 'feature',
  label: 'por feature (módulos por entidad)',
  instructions:
    'Arquitectura FEATURE (por feature): el código de cada entidad vive en ' +
    'server/modules/<entity>/ — <entity>.service.js (lógica de negocio) y ' +
    '<entity>.queries.js (acceso SQLite via server/db.js). ' +
    'server/routes/<name>.js queda fino: importa los handlers del módulo correspondiente ' +
    'y los expone (el auto-mount lo exige — cada entidad sigue montándose en /api/<name>). ' +
    'Para compartir código entre entidades, extraerlo a server/modules/shared/.',
  agentsRules:
    '**Arquitectura por feature**: cada entidad vive en `server/modules/<entity>/` ' +
    '(`<entity>.service.js` = lógica, `<entity>.queries.js` = SQLite via `server/db.js`); ' +
    '`server/routes/*.js` solo importan y exponen los handlers del módulo. ' +
    'Al agregar una entidad nueva, crear su módulo — no mezclar entidades en un archivo.',
  // Variante python (fastapi): módulos por entidad bajo app/modules/,
  // routers finos que solo montan los handlers.
  instructionsFastapi:
    'Arquitectura FEATURE (por feature): el código de cada entidad vive en ' +
    'app/modules/<entity>/ — service.py (lógica de negocio) y queries.py (acceso via app/db.py). ' +
    'app/routers/<name>.py queda fino: importa los handlers del módulo correspondiente ' +
    'y los expone (el auto-mount lo exige — cada entidad sigue montándose en /api/<name>). ' +
    'Para compartir código entre entidades, extraerlo a app/modules/shared/.',
  agentsRulesFastapi:
    '**Arquitectura por feature**: cada entidad vive en `app/modules/<entity>/` ' +
    '(`service.py` = lógica, `queries.py` = acceso via `app/db.py`); ' +
    '`app/routers/*.py` solo importan y exponen los handlers del módulo. ' +
    'Al agregar una entidad nueva, crear su módulo — no mezclar entidades en un archivo.',
};
