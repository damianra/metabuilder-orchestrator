# {{name}}

{{idea}}

> App generada automáticamente por [MetaBuilder Orchestrator](https://github.com/damianra/metabuilder-orchestrator)

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
