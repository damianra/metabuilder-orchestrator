# MetaBuilder — candidatos y próximos pasos

Estado: T1–T7 + `api-skeleton` + semáforo Devin + suite de tests +
validador de PRs por sub-agente completados. Pipeline end-to-end
validado dos veces: `casa-comidas` (orders frontend → repo +
GitHub Pages live) y `tienda-stock` (custom fullstack con concurrencia
de stock).

## Validación de PRs del orquestador

`npm run validate:pr -- <N>` (`src/validate-pr.js`): crea un worktree
temporal del head del PR, corre una sesión Devin
(`prompts/pr-validator.md`) que revisa el diff + ejecuta la validación
funcional (`npm test`, `node --check`, smokes dirigidos) y comenta el
veredicto `✅ APROBADO PARA MERGE | ⚠️ REQUIERE REVISIÓN` en el PR.
El `GITHUB_TOKEN` solo lo usa el script para la API — nunca llega al
agente. Validado en vivo sobre PR #8 y PR #9 (dogfooding).

## Validaciones E2E realizadas

| Run | Tipo | Resultado |
| --- | --- | --- |
| `casa-comidas` | orders / frontend | Repo + GitHub Pages live |
| `tienda-stock` | custom / fullstack | ~10 min, 6 pasos verdes al primer intento (planner LLM + build + vitest + e2e), QA aprobado. Backend sobre api-skeleton: `POST /api/orders` con decremento atómico de stock (`UPDATE ... WHERE stock >= qty` en transacción, rollback → 409). Concurrencia verificada en vivo: 2 POST simultáneos por el último stock → 1×201 + 1×409, stock nunca negativo. |

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
finalVerify), pre-warm de Playwright chromium en background, y
**semáforo global de sesiones Devin** (`tools/devin-lock.js` +
`MAX_CONCURRENT_DEVIN_SESSIONS=1`): varios `npm start` concurrentes
se serializan solos — nunca más de una sesión `devin acp` a la vez.

## Candidatos lógicos (prioridad sugerida)

| # | Candidato | Descripción | Valor |
| --- | --- | --- | --- |
| ~~A~~ | ~~**Tests del orquestador**~~ ✅ | Implementado: `tests/` con 42 tests — validator+verticales, `ghAuthArgs`/sanitize, commit idempotente (git real en tmp), `parseReviewResult`, serialización ACP con stub `devin`, semáforo, install lazy, `copyApiSkeleton`, slug, shell | ~5s, sin tocar Devin ni red |
| B | **orders fullstack real** | Parcialmente validado: `tienda-stock` corrió el camino api-skeleton E2E (custom). Falta correr el vertical `orders` fullstack propiamente (overlay schema/seed/routes + paso generativo-lite) | Completaría el segundo vertical en su forma real |
| C | **Nuevo vertical** (blog/portfolio/catálogo) | Carpeta `src/verticals/<nuevo>` con plan + secciones + checks e2e + overlay `api/` (es el que demuestra el patrón overlay: un blog es `schema.sql` grande + routes, mismo motor) | Amplía el catálogo sin tocar el grafo |
| ~~D~~ | ~~**Robustez de Pages**~~ ✅ parcial | `finalize` ya cae a `getPages` tras fallo de `enablePages` (409/500 tratados como OK). Falta solo retry del POST ante 500 | Residual |
| E | **orders con delivery real** | Costo de envío por zona/mapa, persistir pedido en Sheets, panel admin | Más complejo; probablemente fuera del scope "apps básicas" |

### Candidatos nuevos (revisión 2026-10-24)

| # | Candidato | Descripción | Valor |
| --- | --- | --- | --- |
| F | **`--resume <dir>`** | Hoy NO hay forma de reanudar un run: `MemorySaver` muere con el proceso y no hay flag de re-entrada. `plan.json` ya persiste status/attempts por paso — un `--resume` que lea el checkpoint, reconstruya el estado mínimo y re-ingrese al grafo en el paso pendiente | **Alto**: un Ctrl+C/timeout/crash hoy pierde el run completo y re-gasta todas las sesiones Devin |
| G | **CI: `npm test` en PRs** | No existe `.github/workflows`. La suite corre en ~5s sin Devin ni red — compuerta determinística y gratis que complementa al sub-agente `validate:pr` (que cuesta sesiones) | **Alto y barato**: workflow de ~20 líneas |
| H | **Pool de procesos `devin acp`** | Cada paso paga initialize + authenticate + session/new + set_config (overhead por paso). Mantener el proceso ACP vivo entre pasos del mismo run — `session/new` por paso sigue aislando el contexto — recorta ese costo | Medio: performance, sin cambio semántico |
| I | **Automatizar `validate:pr`** | Hoy es manual (`npm run validate:pr -- <N>`). Opciones: hook post-push local, GitHub Action (requeriría credenciales Devin en secrets — evaluar) o cron | Medio: conveniencia; el camino CI tiene consideraciones de secretos |
| J | **Cola de jobs (`jobs.json` + worker)** | Sigue siendo la decisión pendiente original — formalizar serialización de runs | Medio |
| K | **Convención `.env` en api-skeleton** | Una app `custom` que necesite API keys no tiene convención (dotenv + `.env.example` en el template) | Bajo |
| L | **Reporte de run** | `runs/<runId>/` guarda JSON-RPC crudo; un resumen por run (pasos, reintentos, duración por sesión) ayuda a iterar prompts y detectar patrones de fallo | Bajo-medio |

## Ejecución asincrónica sin saturar (análisis)

Restricciones físicas:

- Cada sesión Devin = 1 proceso `devin acp` (Node) + trabajo del agente remoto.
- Los pasos de un run **comparten el mismo filesystem** del proyecto.
- El verify local (build/vitest/e2e) es CPU-bound breve; Playwright es lo más pesado (~5-15s por spec en Chromium).

Lo que ya tenemos:

- Dentro de un run, las sesiones son **estrictamente secuenciales** (el grafo es un pipeline): nunca hay 2 clientes Devin por run.
- `plan.json` persiste status/attempts por paso (datos para reanudar), pero **la reanudación no está cableada**: el checkpointer es `MemorySaver` (muere con el proceso) y no hay flag de re-entrada → candidato F.

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

- ~~Semáforo de sesiones Devin~~ → implementado (`tools/devin-lock.js`,
  slots mkdir-atómicos + pid file, `MAX_CONCURRENT_DEVIN_SESSIONS=1`
  configurable). Falta solo si se quiere la cola formal de jobs.
- ~~Paralelismo dentro de un run~~ → **descartado** (decidido 2026-10-23):
  backend/frontend tienen dirs disjuntos pero colisionan en
  `package.json`, `plan.json` y la semántica de verify/fixer; el ahorro
  (~1.5 min/run) no justifica la complejidad. Throughput se gana con
  `MAX_CONCURRENT_DEVIN_SESSIONS>1` entre runs (dirs distintos, cero
  colisión).
- ¿Worker con cola (`jobs.json`) o mantener invocación directa (ya
  serializada por el semáforo)? — única decisión abierta.
