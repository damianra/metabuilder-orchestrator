# {{name}}

{{idea}}

> App generada automáticamente por [MetaBuilder Orchestrator](https://github.com/damianra/metabuilder-orchestrator) usando {{engine}} (via ACP).
{{screenshot}}
## Stack

{{stack}}

## Requisitos

- Node.js >= 20

## Levantar el proyecto

```bash
npm install
{{devCommands}}
```

## Tests

```bash
{{testCommands}}
```

## Deploy

Si el proyecto se generó con `--github`, el build de `dist/` queda publicado en GitHub Pages (`https://<usuario>.github.io/{{name}}/`). Pages sirve solo el frontend; en apps fullstack el backend corre aparte (`npm run api`).

## Cumplimiento legal

En apps con frontend se incluye una página `/privacidad` con un aviso de protección de datos personales (GDPR / ePrivacy / Ley 25.326 AR): qué datos se recolectan, finalidad, retención, derechos del titular (ARCO) y contacto del responsable. Los formularios que capturan datos exigen un checkbox de consentimiento. **Antes de publicar**: adaptar los textos a la entidad real (nombre legal, email de contacto, plazos), revisar la jurisdicción aplicable y, si se agregan herramientas de terceros con cookies/trackers (analytics, embebidos), incluir un banner de consentimiento previo. Si el proyecto es solo API, los datos personales que persista siguen requiriendo ese aviso hacia los usuarios finales del servicio.
