# MetaBuilder — candidatos y próximos pasos

Estado: T1–T7 + `api-skeleton` + semáforo Devin + suite de tests +
validador de PRs por sub-agente completados. Pipeline end-to-end
validado tres veces: `casa-comidas` (orders frontend → repo +
GitHub Pages live), `tienda-stock` (custom fullstack con concurrencia
de stock) y `rotiseria-esquina` (orders fullstack con overlay api/).

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
| ~~4~~ | ~~**Nuevo vertical**~~ (C) ✅ | Implementado **`blog`**: posts/categories/tags(N:M)/comments moderados — overlay `api/` con routes posts (`?page&limit&q&category&tag` + `/:slug`), categories, tags, comments (POST → pending). 3 scopes validados, inferAppType con keywords blog/artículo/noticias/posts, overlay verificado en vivo | Catálogo ampliado sin tocar el grafo |
| ~~5~~ | ~~**Pool de procesos `devin acp`**~~ (H) ✅ | Implementado — ver sección Completados | Medio: performance, sin cambio semántico |
| ~~6~~ | ~~**Automatizar `validate:pr`**~~ (I) ✅ | Implementado vía auto-descubrimiento local — ver sección Completados | Medio: conveniencia |
| ~~7~~ | ~~**Cola de jobs (`jobs/` + worker)**~~ (J) ✅ | Implementado austero — ver sección Completados y decisión cerrada abajo | Medio |
| ~~8~~ | ~~**Retry de `enablePages` ante 500**~~ (D residual) ✅ | Implementado — `enablePagesWithRetry` reintenta 5xx antes de caer al GET | Bajo |
| ~~9~~ | ~~**Reporte de run**~~ (L) ✅ | Implementado — `npm run report` (`src/report.js`) | Bajo-medio |
| ~~10~~ | ~~**Convención `.env` en api-skeleton**~~ (K) ✅ | Implementado — dotenv + `.env.example` + regla en el AGENTS.md de apps | Bajo |
| **11** | **orders con delivery real** (E) | Costo de envío por zona/mapa, persistir pedido en Sheets, panel admin | Fuera del scope "apps básicas" por ahora |

### Completados

- ~~A~~ **Tests del orquestador** ✅ — `tests/` con 52 tests (validator+verticales, `ghAuthArgs`/sanitize, commit idempotente, `parseReviewResult`, serialización ACP con stub `devin`, semáforo, install lazy, `copyApiSkeleton`, slug, shell, `extractVerdictComment`, resume), ~5s sin Devin ni red.
- ~~D~~ **Robustez de Pages** ✅ completa — `enablePagesWithRetry` (finalizer.js): reintenta el POST ante 500/502/503 (3 retries, 4s), 409 cae directo al `getPages` de confirmación sin reintentar.
- ~~F~~ **`--resume <dir>`** ✅ — `npm start -- --resume <dir|slug>`: `resolveResumeDir` (ruta o slug), preflight reanuda sin re-copiar, planner normaliza pasos no-done → `pending` y retoma en el primero (todo done → `finalVerify`), restaura scope/appType/idea del plan (`idea` persistido en plan.json). Validado E2E: resume a mitad de plan → done. Un Ctrl+C/timeout ya no pierde el run.
- ~~G~~ **CI `npm test` en PRs** ✅ — `.github/workflows/test.yml` (ubuntu, Node 22, `npm ci` + `npm test`) en `pull_request` y push a `main`.
- ~~C~~ **Vertical `blog`** ✅ — `src/verticals/blog/`: posts/categories/tags(N:M)/comments moderados, overlay api/ verificado en vivo, `inferAppType` con keywords, 3 scopes. También: log de `duración total` al final del pipeline + `elapsedMs` en status.json.
- ~~I~~ **Automatizar `validate:pr`** ✅ — auto-descubrimiento local: `npm run validate:pr` sin args lista PRs abiertos y valida los pendientes (`listOpenPRs` + `getPRComments`); el veredicto embebe `<!-- validate-pr head:<sha7> -->` así un push nuevo marca el PR pendiente otra vez; `--watch [min]` = polling continuo. GitHub Action descartado (el binario `devin` no es instalable en runners y meter `windsurf_api_key` en secrets de CI es exposición innecesaria); hook post-push no existe en git.
- ~~J~~ **Cola de jobs** ✅ — `src/queue.js` + `npm run queue`/`npm run worker`: un archivo por job en `jobs/` (cero locking — add y worker nunca escriben el mismo archivo), ids por create-exclusivo, spawn `node src/index.js` por job con stdio heredado, escritura atómica tmp+rename, jobs `running` al arrancar → `failed` + nota `--resume`.
- ~~K~~ **Convención `.env` en api-skeleton** ✅ — `dotenv` dep + `import 'dotenv/config'` en `server/index.js`, `.env.example` commiteado (copiado por `copyApiSkeleton`), `.env` en `gitignore.partial`, regla en `src/templates/AGENTS.md` (secretos via `process.env`, declarados en `.env.example`). Verificado E2E: server levanta con `PORT` leído de `.env`.
- ~~L~~ **Reporte de run** ✅ — `src/report.js` + `npm run report`: resume `runs/<id>/` en `report.md` — pasos con intentos, duración por sesión Devin (birthtime→mtime del log), prompts por sesión, totales (tiempo en Devin, intentos, fixes). Deriva duración de runs viejos sin `elapsedMs` desde el timestamp del runId.
- ~~H~~ **Pool de procesos `devin acp`** ✅ — `warmClient` en `tools/devin.js` mantiene un proceso tibio a nivel módulo: initialize+authenticate una sola vez por run, `session/new` por paso (aislamiento intacto), `setLog` rota el run log. Proceso muerto → descarte y respawn automático; hook `exit` mata al hijo con el CLI. `reused` expuesto en el resultado + `acpPoolStats()` para tests.

## Ejecución asincrónica sin saturar (análisis)

Restricciones físicas:

- Cada sesión Devin = 1 proceso `devin acp` (Node) + trabajo del agente remoto.
- Los pasos de un run **comparten el mismo filesystem** del proyecto.
- El verify local (build/vitest/e2e) es CPU-bound breve; Playwright es lo más pesado (~5-15s por spec en Chromium).

Lo que ya tenemos:

- Dentro de un run, las sesiones son **estrictamente secuenciales** (el grafo es un pipeline): nunca hay 2 clientes Devin por run.
- `plan.json` persiste status/attempts por paso y `--resume <dir>` ya reanuda (ver Completados).

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
- ~~Worker con cola (`jobs.json`) o mantener invocación directa~~ →
  **decidido** (2026-10-24): cola austera implementada (`src/queue.js` —
  un archivo por job en `jobs/`, `npm run queue` + `npm run worker`).
  La invocación directa sigue siendo válida; la cola es opt-in para
  batch desatendido. Sin daemon ni locking: el worker es el único que
  muta estados de jobs en vuelo.
