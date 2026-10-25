# MetaBuilder — Orquestador de desarrollo con agentes

*Desarrollado con [Devin](https://devin.ai) (ex Windsurf) utilizando el modelo SWE-2.*

MetaBuilder convierte una idea en texto libre en una aplicación funcionando (landing pages, webs de pedidos con carrito y WhatsApp, blogs, etc.) mediante un **harness multi-agente construido sobre LangGraph**: un orquestador determinístico coordina sub-agentes que escriben el código con **Devin CLI via ACP**. La arquitectura es **híbrida** — cada tarea la ejecuta el recurso más barato capaz de resolverla: código local para lo predecible (planes por vertical, copia del skeleton, validación del plan, verificaciones, git/README/deploy) y **sesiones Devin solo para lo generativo** (un builder por paso del plan, un fixer que recibe el stderr real del fallo, y un revisor QA que aprueba o rechaza la app terminada). Cada paso corre en su propia sesión aislada (sobre un proceso `devin acp` reutilizado por el run — initialize+authenticate una sola vez, `session/new` por paso) y el estado vive en `plan.json` + el filesystem, con lo que el pipeline puede reintentar, reanudar y pedir aprobación del plan antes de gastar una sola llamada al agente. Los beneficios: una app lista en ~5 minutos y pocas sesiones en lugar de un agente pesado por tarea; fallos acotados al paso que los causó con reparación dirigida; verificaciones reales (build + tests + e2e) como compuertas entre etapas; y un humano en el loop (plan → aprobar → construir) que evita desperdiciar trabajo en planes equivocados.

## Cómo funciona

```
preflight → planner → validate ─┬─→ confirm → builder → verify ─┬─→ builder (siguiente paso)
                                │                               ├─→ finalVerify → review ─┬─→ finalize → END
                                └─→ repairPlan                  └─→ fixer → verify        └─→ fixer
```

| Nodo | Qué hace |
| --- | --- |
| `preflight` | Chequea binarios + auth Devin (ACP) en paralelo, crea `generated-apps/<slug>/`, copia `AGENTS.md` y los **skeletons**: `app-skeleton` (Vite+React+Tailwind+Vitest+Playwright) o `app-skeleton-next` (Next.js+React+Tailwind, según `--stack-frontend`) si el vertical tiene frontend, `api-skeleton` (Express 5 + SQLite + uploads + auto-mount de routes) si el scope tiene backend, más el **overlay** del vertical (`schema.sql`/`seed-data.js`/`routes/`). `npm install` y el pre-warm de Playwright corren en background. |
| `planner` | Genera `plan.json`. Si `appType` es un **vertical conocido** (`landing`, `orders`, `blog`) usa un template determinístico (**sin llamar a Devin**); si es `custom`, una sesión Devin ACP lo escribe. Si ya existe `plan.json`, lo reutiliza (resume). |
| `validate` | Validación 100% local del plan (schema, tipos de paso, `verify` ejecutable, requisitos por scope). |
| `confirm` | `interrupt()` de LangGraph: muestra el plan y espera `[S/n]` — solo en TTY y sin `--yes`. |
| `builder` | Una sesión Devin ACP por paso (`prompts/builder.md`). Pasos `infra` con skeleton ya copiado no consumen Devin. |
| `verify` | Corre el comando `verify` del paso dentro del proyecto (`execa`, nunca lanza). |
| `fixer` | Si verify falla: manda a Devin la descripción del paso + stderr (`prompts/fixer.md`). Máx `MAX_STEP_RETRIES` (3) intentos. |
| `finalVerify` | Batería por scope: `npm run build` + `npx vitest run` + `npm run test:e2e` (solo si hay frontend; backend → solo vitest). |
| `review` | Sub-agente QA: sesión Devin revisa la app contra `AGENTS.md` y la idea (`prompts/reviewer.md`). `RESULT: APPROVED` → finalize; `RESULT: ISSUES` → fixer. |
| `finalize` | Genera `README.md` (descripción + cómo levantarlo + crédito a MetaBuilder), `git init/commit`, y push según modo. |
| `repairPlan` / `fail` | Reparación del plan (máx `MAX_PLAN_RETRIES`=2, solo errores de contenido) / terminación en `failed`. |

## Feedback en vivo y `status.json`

Durante el run el CLI reporta progreso en tiempo real (streaming `streamMode: 'updates'`): una línea por nodo en stdout (`🛠 dev [paso 2/5] …`) y la actividad de herramientas del agente en stderr (`▸ edit: src/App.jsx`, deduplicada y throttled). Además, cada update escribe `status.json` dentro del proyecto:

```json
{ "node": "build", "status": "running", "step": 2, "totalSteps": 5, "lastError": null, "ts": "…" }
```

Pensado para workers/CI que necesiten el estado del pipeline sin parsear la terminal. `--quiet` silencia el reporte por nodo y la actividad, pero `status.json` y el resultado/historial final se emiten igual.

## Contexto inicial: qué necesita el orquestador

La entrada mínima es **la idea** — una descripción en texto libre de la app a crear. Con eso:

- `--app-type` decide el **vertical** (paquete de plan+secciones predefinidas). Si no se pasa, se **infiere de la idea** (`pedido/restaurante/comida/pizza…` → `orders`; resto con frontend → `landing`; backend puro → `custom` — que usa el planner LLM).
- `--scope` decide qué construir: `fullstack` (front+back), `frontend`, `backend`.
- `--stack-frontend`/`--stack-backend` deciden el **stack** (ver abajo); defaults si no se pasan.
- `--name` fija el slug del directorio/repo; vacío → derivado de la idea.

## Stacks disponibles

Un **stack** es un paquete cerrado de tecnologías — se elige entero, no por piezas, y nunca se infiere del texto de la idea (solo flag/picker del dashboard/pregunta interactiva). El id agrupa todo lo necesario para que la app funcione: framework + build tool + testing.

| Id | Kind | Incluye | Build → |
| --- | --- | --- | --- |
| `vite-react` (default) | frontend | Vite (build tool) + React (UI) + Tailwind + Vitest + Playwright | `dist/` |
| `nextjs` | frontend | Next.js 15 (App Router, `output: 'export'`) + React 19 + Tailwind + Vitest + Playwright | `out/` |
| `express-sqlite` (default) | backend | Express 5 + better-sqlite3 + multer | — |

Los stacks están declarados como datos en `src/stacks/` — agregar uno nuevo (ej. Vue, Fastify) = nuevo archivo de definición + skeleton en `src/templates/`; aparece solo en el CLI y el dashboard.

Ejemplos de contexto inicial:

```bash
# Todo explícito, sin preguntas
npm start -- --idea "Landing de cafetería con menú y contacto" --app-type landing --scope frontend --name cafe --phone 5491155500000 -y

# Mínimo: la idea; lo demás se infiere (orders+fullstack si habla de pedidos)
npm start -- --idea "Pizzería con pedidos a domicilio" -y

# Interactivo: pregunta lo que falte
npm start
```

## Cola de generaciones (batch)

Para encolar varias ideas y procesarlas desatendido, una por vez:

```bash
npm run queue -- add --idea "Blog de recetas" --app-type blog -y
npm run queue -- add --idea "Landing veterinaria" --app-type landing --scope frontend -y
npm run queue -- list        # estado de cada job (pending/running/done/failed)
npm run worker               # procesa la cola en orden, logs en vivo
npm run queue -- watch       # idem en loop + heartbeat (el modo que usa el dashboard)
npm run queue -- clear       # borra jobs terminados
```

Cada job es un archivo en `jobs/` (gitignored); el worker spawnea `node src/index.js` por job — equivale a correr `npm start` a mano, en serie — y captura su stdout/stderr en `jobs/<id>.log`. Un job `failed` se retoma con `--resume generated-apps/<slug>`. El semáforo de sesiones Devin sigue siendo la red de seguridad para runs sueltos.

## Dashboard

Dos componentes locales en el propio repo:

| Componente | Dónde | Cómo levantarlo |
| --- | --- | --- |
| **Backend (API)** | `src/dashboard/server.js` — Express 5 | `npm run dashboard:api` → `http://127.0.0.1:4100` (`DASHBOARD_PORT`/`DASHBOARD_HOST` para cambiar) |
| **Frontend (UI)** | `dashboard/` — subpackage Vite+React+Tailwind con su propio `package.json` | `npm --prefix dashboard install` (una vez) y `npm --prefix dashboard run dev` → `http://127.0.0.1:4173` (proxy `/api` → :4100) |

O todo junto con un solo comando (recomendado — `Ctrl+C` mata los tres):

```bash
npm install                        # deps del orquestador
npm --prefix dashboard install     # deps de la UI (una sola vez)
npm run dashboard                  # API :4100 + UI :4173 + worker de la cola
# npm run worker no hace falta: el dashboard ya levanta el worker en
# modo watch (queue.js). Solo se usa para procesar la cola a mano.
```

La UI (mismo stack que las apps generadas) sirve para lanzar generaciones y supervisar `generated-apps/`:

- **Nueva app** — formulario con nombre/idea + pickers de scope/vertical/arquitectura/stacks (alimentados de `GET /api/options`, que lee los registries — nada hardcodeado) + flags GitHub/Pages/verify-docker. Encola el job; el worker del dashboard lo procesa.
- **Cola** — cada job muestra su estado con progreso en vivo (`running · paso X/Y · nodo` leído del `status.json` de la app). Si hay jobs `pending` y el worker no está vivo (heartbeat `jobs/.worker`), avisa "sin worker consumiendo la cola".
- **Proyectos** — cards con status, pasos done/total con barra, scope/arch, badge docker; click → detalle.
- **Detalle** (`#/p/<slug>`) — acciones **Resume** (opción con GitHub) / **Dockerize** (build async con docker o podman) / **Ejecutar tests** (`npm test` + opcional `test:e2e`, async → `test-run.json`/`test-run.log` en la app) / **Abrir repo**; acordeón del prompt original con los parámetros del plan, tabla de comandos del package.json, sección **Contenedor** (crear/detener/ver logs del container — detecta docker o podman, deshabilitado si no hay engine o si falta la imagen), log del run del pipeline, output del último test run y reporte del último run.
- **Terminal Devin** — acordeón en el detalle que abre una sesión interactiva de `devin` (el CLI completo, TUI) con cwd en `generated-apps/<slug>/` — el usuario chatea con Devin directamente sobre el repo de la app para pedir cambios (xterm.js ↔ WebSocket ↔ PTY). La sesión adquiere un slot del semáforo Devin: si hay una generación corriendo espera ("slot ocupado"). Colapsar no mata la sesión (queda ~5 min para reattach con scrollback); **Cerrar sesión** la termina. Requiere `node-pty` (dep nativa — si no compila, el resto del dashboard funciona igual) y que `devin` esté autenticado (`devin auth login` — la primera vez se puede hacer desde la misma terminal embebida; el `windsurf_api_key` de credentials.toml solo alcanza para el modo ACP del orquestador, no para el TUI interactivo).
- **Cola** — jobs activos y recientes; indicador de API caída en el header.

Endpoints de la API:

- `GET /api/projects` · `GET /api/projects/:slug` · `GET /api/jobs` · `GET /api/options` · `GET /api/health`
- `GET /api/jobs/:id/log?tail=N` — tail del log del worker para ese job (`jobs/<id>.log`); `GET /api/projects/:slug/log` — idem resolviendo el último job del proyecto; `GET /api/projects/:slug/test-log` — tail del output del último test run (`test-run.log` en la app); `GET /api/runtime` — engine de containers (`docker`/`podman`/`null`); `GET /api/projects/:slug/container-log` — `docker logs --tail` del container si corre
- `POST /api/runs` — `{idea, scope?, appType?, name?, arch?, stackFrontend?, stackBackend?, phone?, github?, ghpages?, verifyDocker?}` (valida enums/slug, encola con `--yes`)
- `POST /api/projects/:slug/actions` — `{action: "resume"|"dockerize"|"test"|"run-container"|"stop-container"|"open-repo"}` (`test` acepta `e2e: true`; `run-container` acepta `port` para el puerto host — default 4000 o 8080 según la variante)
- `WS /api/projects/:slug/terminal` — sesión `devin` interactiva (PTY) en el dir de la app. Mensajes JSON: client→server `{t:'in'|'resize'|'close'}`, server→client `{t:'out'|'status'|'exit'|'error'}`. Una sesión por slug (clientes extra se adjuntan con replay de scrollback); se cierra con `close`, exit del pty, o ~5 min sin clientes

La API solo encola, no ejecuta — el worker procesa los jobs como siempre.

## Flags

| Flag | Qué hace |
| --- | --- |
| `--idea "<texto>"` | **Requerido** (o se pregunta en modo interactivo). Descripción de la app. |
| `--scope` | `fullstack` \| `frontend` \| `backend` (default `fullstack`). |
| `--app-type` | `landing` \| `orders` \| `blog` \| `custom`. `landing`/`orders`/`blog` usan plan template (instantáneo); `custom` usa planner LLM. Default: inferido. |
| `--name <slug>` | Nombre del proyecto/dir/repo. Default: slug de la idea (con sufijo si existe). |
| `--arch <id>` | Patrón de arquitectura de los pasos backend: `flat` (default — toda la lógica en `server/routes/`), `mvc` (models + controllers), `layers` (controllers → services → repositories), `feature` (`server/modules/<entidad>/`). Solo aplica si el scope tiene backend; se declara en cada paso backend del plan y persiste en `plan.arch` (resume lo restaura). |
| `--stack-frontend <id>` | Stack de UI: `vite-react` (default — Vite + React + Tailwind, build → `dist/`) o `nextjs` (Next.js 15 + React 19 + Tailwind, `output: 'export'` → `out/`). Persiste en `plan.stacks` (resume lo restaura). |
| `--stack-backend <id>` | Stack de API: `express-sqlite` (único disponible). Idem `plan.stacks`. |
| `--resume <dir\|slug>` | **Reanuda un run** desde su `plan.json` (ruta o nombre en `generated-apps/`). No requiere `--idea` ni `--scope`/`--app-type` (los restaura del plan). Los pasos `done` se saltan, los que no terminaron vuelven a `pending` y el pipeline retoma en el primero pendiente — si están todos hechos, salta a `finalVerify` + QA + finalize. Los flags de deploy (`--github`/`--ghpages`/`--no-push`) aplican igual. |
| `-y` / `--yes` | No pedir confirmación del plan ni preguntas interactivas. |
| `--github` | Tras aprobación del QA: crea el repo en GitHub (REST, `GITHUB_TOKEN`) y pushea `main`. **No** publica Pages por sí solo. |
| `--ghpages` | Publica el build del frontend (`dist/` Vite / `out/` Next) en rama `gh-pages` y activa GitHub Pages (`https://<user>.github.io/<repo>/`). **Requiere `--github`**; solo aplica a scopes con frontend (`frontend`/`fullstack`). Con `nextjs` el build se repite con `PAGES_BASE=/<repo>` para el basePath correcto. |
| `--phone <num>` | WhatsApp del negocio en formato internacional sin `+` (ej. `5491155500000`). Se inyecta en los verticales: landing → botón flotante con mini-form → `wa.me`; orders → checkout del carrito con items+total → `wa.me`. Vacío → placeholder `5491100000000`; si en la app queda vacío, el botón no se renderiza. |
| `--no-push` | Solo commit local, nada remoto. |
| `--keep-going` | Continuar al siguiente paso aunque uno agote reintentos (en vez de `fail`). |
| `--quiet` | Sin reporte por nodo ni actividad de tools (solo resultado/historial final). `status.json` se escribe igual. |
| `--verbose` | Mensajes de los nodos sin truncar (default: 220 chars por línea). |
| `--verify-docker` | En `finalVerify`, corre `docker build -t <slug>:verify .` sobre el `Dockerfile` de la app (cada app generada ya lo trae, junto a `.dockerignore`; frontend-only también `nginx.conf`). Si no hay daemon **docker** disponible se omite sin fallar — es docker-only: en hosts con solo podman siempre se omite. |

## Configuración (`.env`)

```bash
cp .env.example .env
```

| Variable | Para qué |
| --- | --- |
| `GITHUB_TOKEN` | PAT clásico scope `repo` (github.com/settings/tokens). Habilita `--github`. |
| `GITHUB_REPO_URL` | Alternativa a `--github`: pushea a un repo **pre-creado** (SSH). Sin crear repo ni Pages. |
| `GIT_USER_NAME` / `GIT_USER_EMAIL` | Identidad de los commits en las apps generadas. |
| `DEVIN_MODEL` | Default `swe-2-high` (gratuito). |
| `DEVIN_TIMEOUT_MS` | Timeout por sesión Devin (default 15 min). |
| `MAX_STEP_RETRIES` / `MAX_PLAN_RETRIES` | Reintentos de fix por paso / de reparación de plan (3 / 2). |
| `VERIFY_TIMEOUT_MS` | Timeout por comando `verify` (default 5 min). |
| `MAX_CONCURRENT_DEVIN_SESSIONS` | Semáforo global de sesiones Devin entre procesos (`~/.metabuilder/devin-slots/`). Default `1` — aunque haya varios `npm start`, nunca más de una sesión `devin acp` a la vez. |
| `DEVIN_SLOTS_DIR` | Override del dir del semáforo (default `~/.metabuilder/devin-slots/`). Lo usan los tests para no competir con runs reales. |

## Requisitos

- Node.js >= 22, npm, git.
- **Devin CLI** autenticado vía cuenta Windsurf: `~/.local/share/devin/credentials.toml` con `windsurf_api_key` (lo escribe Devin Desktop). El orquestador usa `devin acp` (mismo canal que Devin Desktop) — **`devin -p`/`auth status` reportan "Not logged in" con estas credenciales y NO son la vía**.
- Playwright Chromium: se instala una vez en `~/.cache/ms-playwright` (compartido entre apps).

## Estructura

- `src/index.js` — CLI (flags + modo interactivo + loop de confirmación + feedback en vivo / `status.json`).
- `src/orchestrator/` — `state.js` (canales) + `graph.js` (routing + checkpointer).
- `src/agents/` — nodos: preflight, planner, validator, confirm, builder, verifier, fixer, reviewer, finalizer.
- `src/tools/` — `devin.js` (cliente ACP), `shell.js` (execa), `slug.js`, `github.js` (REST: repos, Pages, PRs), `install.js` (npm install lazy en background).
- `src/prompts/` — builder/fixer/planner/plan-repair/reviewer/pr-validator.md.
- `src/validate-pr.js` — sub-agente Devin que valida PRs del orquestador en un worktree aislado y comenta el veredicto (el `GITHUB_TOKEN` nunca llega al agente). `npm run validate:pr -- <N>` valida uno; sin args valida todos los abiertos pendientes (detecta por el head SHA embebido en el veredicto — un push nuevo lo marca pendiente otra vez); `--watch [min]` hace polling continuo.
- `src/stacks/` — registry declarativo de stacks (`vite-react`, `nextjs`, `express-sqlite`): skeleton, `buildDir`, comandos de verify, requisitos de `validatePlan` y bullets que los prompts inyectan (`{{stackRules}}`) — una sola fuente para validator y planner. `--stack-frontend`/`--stack-backend` seleccionan; `plan.stacks` persiste para resume.
- `src/arch/` — registry de patrones de arquitectura de backend (`flat`, `mvc`, `layers`, `feature`): `--arch <id>` selecciona; `applyArch` inyecta el patrón en los pasos backend, `plan.arch` persiste para resume, el AGENTS.md de la app generada recibe las reglas del patrón.
- `src/verticals/` — paquetes por tipo de app (`landing`, `orders`, `blog`): `buildPlan()` determinístico; `orders` y `blog` traen overlay `api/` (schema + seed + routes) para el api-skeleton.
- `src/templates/` — `AGENTS.md` (reglas UI + guía de diseño copiadas a cada app), `README.md`, `app-skeleton/` (frontend Vite), `app-skeleton-next/` (frontend Next.js export estático), `api-skeleton/` (backend Express+SQLite+uploads), `docker/` (Dockerfile por variante + `.dockerignore` + `nginx.conf` para frontend-only; `FROM` fully-qualified `docker.io/library/...` para compat podman).
- `src/verticals/<v>/api/` — overlay de backend por vertical (schema.sql + seed-data.js + routes/) que se copia sobre `server/`.
- `generated-apps/` — apps generadas (**gitignored**, cada una con su repo git).
- `runs/` — logs JSON-RPC de cada sesión Devin (**gitignored**). `npm run report -- <runId|slug>` los resume en markdown (pasos, intentos, duración por sesión, totales) y lo guarda en `runs/<runId>/report.md`; sin args lista los runs recientes.
- `tests/` — suite Vitest del orquestador (`npm test`): validator+verticales, slug, shell, install lazy, semáforo Devin, copyApiSkeleton, ghAuthArgs/sanitize/commit idempotente, parseo del reviewer, serialización ACP (stub `devin` en `tests/fixtures/`), resume. Corre en CI (`.github/workflows/test.yml`) en cada PR y push a main.
- `.github/workflows/test.yml` — CI: `npm test` en PRs y main (Node 22, sin Devin ni secrets).
- `ROADMAP.md` — roadmap v3: iteración post-generación (terminal Devin por proyecto, feed en vivo del agente), control de jobs (cancelar/reintentar), correr apps sin containers y housekeeping. Histórico en `docs/archive/`.

## Qué contiene cada app generada

- `plan.json` — checkpoint con status/attempts por paso.
- `status.json` — último estado reportado del pipeline (nodo, step/totalSteps, lastError).
- `AGENTS.md` — reglas de UI + guía de diseño.
- `README.md` — descripción, cómo levantarlo, crédito a MetaBuilder.
- Repo git propio con commit inicial (remoto con `--github`, Pages además con `--ghpages`).
