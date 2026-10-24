# MetaBuilder — candidatos y próximos pasos

Estado: T1–T7 + `api-skeleton` completados. Pipeline end-to-end validado
(`casa-comidas` → repo + GitHub Pages live).

## Implementado: `api-skeleton` — backend predefinido

`src/templates/api-skeleton/` (Express 5 + better-sqlite3 + multer):
`server/{index,app,db,schema.sql,seed-data.js}`, auto-mount de
`server/routes/*.js` en `/api/*`, `POST /api/uploads` → `/uploads/`,
test vitest de `/api/health`, `package.partial.json` mergeado por
preflight. Los verticales aportan overlay en `src/verticals/<v>/api/`
(orders: schema business/categories/products/orders/order_items +
routes). El paso backend quedó generativo-lite (Devin personaliza
seed + endpoints extra de la idea).

Asincronía aplicada: probes de preflight en paralelo, `npm install`
lazy en background (`tools/install.js`, awaitan builder/verifier/
finalVerify), pre-warm de Playwright chromium en background.

## Candidatos lógicos (prioridad sugerida)

| # | Candidato | Descripción | Valor |
| --- | --- | --- | --- |
| A | **Tests del orquestador** | Vitest: `ghAuthArgs` (header Basic), commit idempotente, templates de plan, parsing de `RESULT:` del reviewer, serialización de mensajes | El código crítico de git/API hoy solo se prueba en vivo — una regresión silenciosa rompería el pipeline |
| B | **orders fullstack real** | El template fullstack existe pero nunca corrió E2E con Devin (Express+SQLite + frontend consumiéndolo). En validación | Completaría el segundo vertical en su forma real |
| C | **Nuevo vertical** (blog/portfolio/catálogo) | Carpeta `src/verticals/<nuevo>` con plan + secciones + checks e2e | Amplía el catálogo sin tocar el grafo |
| D | **Robustez de Pages** | Reintentar `enablePages` ante 500 transitorio y tratar 409 como éxito | Pulir el único fallo "ruidoso" observado |
| E | **orders con delivery real** | Costo de envío por zona/mapa, persistir pedido en Sheets, panel admin | Más complejo; probablemente fuera del scope "apps básicas" |

## Ejecución asincrónica sin saturar (análisis)

Restricciones físicas:

- Cada sesión Devin = 1 proceso `devin acp` (Node) + trabajo del agente remoto.
- Los pasos de un run **comparten el mismo filesystem** del proyecto.
- El verify local (build/vitest/e2e) es CPU-bound breve; Playwright es lo más pesado (~5-15s por spec en Chromium).

Lo que ya tenemos:

- Dentro de un run, las sesiones son **estrictamente secuenciales** (el grafo es un pipeline): nunca hay 2 clientes Devin por run.
- `plan.json` + checkpointer permiten reanudar — un run largo puede pausarse/reintentarse.

### Posibilidades

1. **Cola serial de runs (recomendada).** `jobs.json` + `npm run worker` que
   procesa una app por vez. Lanzar varias generaciones = encolar, no
   paralelizar. Garantiza ≤1 sesión Devin activa en toda la máquina.
   Es el modelo que mejor respeta "no saturar el equipo ni multiplicar
   clientes Devin": el equipo local solo hace trabajo barato mientras el
   agente procesa, y el agente nunca se duplica.

2. **Semáforo global de sesiones Devin.** Lock por slot en
   `~/.metabuilder/devin-slots/` (mkdir atómico o `flock`). Aunque se
   lancen N procesos `npm start` a mano, las sesiones Devin se serializan
   y el trabajo local (verify, install, git) sí paraleliza entre runs.
   Requiere que `tools/devin.js` adquiera el slot antes del spawn.
   Config: `MAX_CONCURRENT_DEVIN_SESSIONS` en `.env` (default 1).

3. **Paralelismo dentro de un run. NO recomendado.** Los pasos builder
   comparten el mismo directorio del proyecto — dos agentes escribiendo
   a la vez generan conflictos de archivos. Solo los pasos test/e2e
   post-implementación serían paralelizables en teoría, con ahorro
   marginal y riesgo de carreras en `node_modules`.

4. **Paralelismo entre apps.** Seguro (directorios distintos) pero
   multiplica clientes Devin — solo con el semáforo de (2) como límite.

### Recomendación

Combinar (1)+(2): cola serial por defecto (`MAX_JOBS=1`), semáforo de
slots como red de seguridad para procesos sueltos. El equipo queda con
a lo sumo 1 agente + trabajos locales livianos — nunca más clientes
Devin que el límite configurado.

## Decisión pendiente

- ¿Worker con cola (`jobs.json`) o mantener invocación directa + semáforo?
- ¿`MAX_CONCURRENT_DEVIN_SESSIONS=1` fijo o configurable?
