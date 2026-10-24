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
| `rotiseria-esquina` | **orders / fullstack** | ~13 min, 5/5 pasos verdes al primer intento, QA aprobado. Overlay api/ intacto (routes no tocadas por Devin), seed personalizado (29 productos, business, WhatsApp real), `api.test.js` generado, POST /api/orders 201 con total server-side + transacción, frontend con carrito + checkout wa.me. |

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

## Backlog priorizado (revisión 2026-10-24)

Ordenado por impacto/esfuerzo. **El #1 es la recomendación actual.**

| # | Candidato | Descripción | Valor |
| --- | --- | --- | --- |
| ~~1~~ | ~~**`--resume <dir>`**~~ (F) ✅ | Implementado y validado E2E — ver sección Completados | Un Ctrl+C/timeout ya no pierde el run |
| ~~2~~ | ~~**CI: `npm test` en PRs**~~ (G) ✅ | Implementado: `.github/workflows/test.yml` corre la suite (52 tests, ~5s) en cada PR y push a main — compuerta determinística gratis que complementa al sub-agente `validate:pr` | Hecho |
| ~~3~~ | ~~**orders fullstack real**~~ (B) ✅ | Validado E2E con `rotiseria-esquina`: 5/5 pasos verdes al primer intento, overlay api/ aplicado intacto, generativo-lite personalizó seed (29 productos con sabor de la idea + business + WhatsApp) y agregó `api.test.js`, POST /api/orders con total server-side → 201, frontend consume `/api/*` + checkout wa.me con items | Segundo vertical en su forma real |
| **4** | **Nuevo vertical** (C) | Carpeta `src/verticals/<nuevo>` (blog/portfolio/catálogo) con plan + secciones + checks e2e + overlay `api/` — es el que demuestra el patrón overlay: un blog es `schema.sql` grande + routes, mismo motor | Amplía el catálogo sin tocar el grafo |
| **5** | **Pool de procesos `devin acp`** (H) | Cada paso paga initialize + authenticate + session/new + set_config (overhead por paso). Mantener el proceso ACP vivo entre pasos del mismo run — `session/new` por paso sigue aislando el contexto — recorta ese costo | Medio: performance, sin cambio semántico |
| **6** | **Automatizar `validate:pr`** (I) | Hoy es manual (`npm run validate:pr -- <N>`). Opciones: hook post-push local, GitHub Action (requeriría credenciales Devin en secrets — evaluar) o cron | Medio: conveniencia; el camino CI tiene consideraciones de secretos |
| **7** | **Cola de jobs (`jobs.json` + worker)** (J) | Sigue siendo la decisión pendiente original — formalizar serialización de runs (ver sección abajo) | Medio — **requiere decisión previa** |
| **8** | **Retry de `enablePages` ante 500** (D residual) | `finalize` ya cae a `getPages` tras fallo (409/500 tratados como OK) — falta solo reintentar el POST ante 500 transitorio | Bajo: pulido chico |
| **9** | **Reporte de run** (L) | `runs/<runId>/` guarda JSON-RPC crudo; un resumen por run (pasos, reintentos, duración por sesión) ayuda a iterar prompts y detectar patrones de fallo | Bajo-medio |
| **10** | **Convención `.env` en api-skeleton** (K) | Una app `custom` que necesite API keys no tiene convención (dotenv + `.env.example` en el template) | Bajo |
| **11** | **orders con delivery real** (E) | Costo de envío por zona/mapa, persistir pedido en Sheets, panel admin | Fuera del scope "apps básicas" por ahora |

### Completados

- ~~A~~ **Tests del orquestador** ✅ — `tests/` con 52 tests (validator+verticales, `ghAuthArgs`/sanitize, commit idempotente, `parseReviewResult`, serialización ACP con stub `devin`, semáforo, install lazy, `copyApiSkeleton`, slug, shell, `extractVerdictComment`, resume), ~5s sin Devin ni red.
- ~~D~~ **Robustez de Pages** ✅ parcial — fallback `getPages` ya implementado; el retry del 500 quedó como ítem #8.
- ~~F~~ **`--resume <dir>`** ✅ — `npm start -- --resume <dir|slug>`: `resolveResumeDir` (ruta o slug), preflight reanuda sin re-copiar, planner normaliza pasos no-done → `pending` y retoma en el primero (todo done → `finalVerify`), restaura scope/appType/idea del plan (`idea` persistido en plan.json). Validado E2E: resume a mitad de plan → done. Un Ctrl+C/timeout ya no pierde el run.
- ~~G~~ **CI `npm test` en PRs** ✅ — `.github/workflows/test.yml` (ubuntu, Node 22, `npm ci` + `npm test`) en `pull_request` y push a `main`.

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
