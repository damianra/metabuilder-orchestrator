El archivo `plan.json` de este directorio falló la validación del orquestador. Corregilo para que cumpla el schema y las reglas, sin cambiar el objetivo del plan.

## Errores de validación

{{errors}}

## Scope requerido: `{{scope}}`

## Schema obligatorio

```json
{
  "projectName": "{{slug}}",
  "scope": "{{scope}}",
  "appType": "landing|orders|blog|custom",
  "validated": false,
  "steps": [
    { "id": 1, "description": "...", "type": "frontend|backend|test|e2e|infra",
      "verify": "comando shell real", "status": "pending", "attempts": 0 }
  ]
}
```

Recordatorio de reglas: pasos atómicos con `verify` ejecutable; scope frontend excluye backend y viceversa; frontend/fullstack requieren init Vite+Tailwind + paso `e2e` con Playwright (`npm run test:e2e`); backend/fullstack requieren Express+SQLite; siempre un paso `test` con Vitest. Escribí el `plan.json` corregido completo.
