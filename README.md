# MetaBuilder — Orquestador de desarrollo con agentes

MetaBuilder convierte una idea en texto libre en una aplicación funcionando (landing pages, webs de pedidos con carrito y WhatsApp, blogs, etc.) mediante un **harness multi-agente construido sobre LangGraph**: un orquestador determinístico coordina sub-agentes que escriben el código con **Devin CLI via ACP**. La arquitectura es **híbrida** — cada tarea la ejecuta el recurso más barato capaz de resolverla: código local para lo predecible (planes por vertical, copia del skeleton, validación del plan, verificaciones, git/README/deploy) y **sesiones Devin solo para lo generativo** (un builder por paso del plan, un fixer que recibe el stderr real del fallo, y un revisor QA que aprueba o rechaza la app terminada). Cada paso corre en su propia sesión aislada (sobre un proceso `devin acp` reutilizado por el run — initialize+authenticate una sola vez, `session/new` por paso) y el estado vive en `plan.json` + el filesystem, con lo que el pipeline puede reintentar, reanudar y pedir aprobación del plan antes de gastar una sola llamada al agente. Los beneficios: una app lista en ~5 minutos y pocas sesiones en lugar de un agente pesado por tarea; fallos acotados al paso que los causó con reparación dirigida; verificaciones reales (build + tests + e2e) como compuertas entre etapas; y un humano en el loop (plan → aprobar → construir) que evita desperdiciar trabajo en planes equivocados.

## Cómo funciona

```
preflight → planner → validate ─┬─→ confirm → builder → verify ─┬─→ builder (siguiente paso)
                                │                               ├─→ finalVerify → review ─┬─→ finalize → END
                                └─→ repairPlan                  └─→ fixer → verify        └─→ fixer
```

| Nodo | Qué hace |
| --- | --- |
| `preflight` | Chequea binarios + auth Devin (ACP) en paralelo, crea `generated-apps/<slug>/`, copia `AGENTS.md` y los **skeletons**: `app-skeleton` (Vite+React+Tailwind+Vitest+Playwright) si el vertical tiene frontend, `api-skeleton` (Express 5 + SQLite + uploads + auto-mount de routes) si el scope tiene backend, más el **overlay** del vertical (`schema.sql`/`seed-data.js`/`routes/`). `npm install` y el pre-warm de Playwright corren en background. |
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
- `--name` fija el slug del directorio/repo; vacío → derivado de la idea.

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
npm run queue -- clear       # borra jobs terminados
```

Cada job es un archivo en `jobs/` (gitignored); el worker spawnea `node src/index.js` por job — equivale a correr `npm start` a mano, en serie. Un job `failed` se retoma con `--resume generated-apps/<slug>`. El semáforo de sesiones Devin sigue siendo la red de seguridad para runs sueltos.

## API del dashboard

```bash
npm run dashboard:api   # http://127.0.0.1:4100 (DASHBOARD_PORT / DASHBOARD_HOST)
```

API local que el dashboard (roadmap #5) consume — capa fina sobre `queue.js`, `plan.json`/`status.json` y los reportes:

- `GET /api/projects` — resumen de cada app en `generated-apps/` (status, pasos done/total, scope, arch, `hasDockerfile`).
- `GET /api/projects/:slug` — detalle: pasos del plan, reporte del último run, `repoUrl`, estado del último docker build.
- `GET /api/jobs` — la cola tal cual la ve el worker.
- `POST /api/runs` — encola una generación (`{idea, scope?, appType?, name?, arch?, phone?, github?, ghpages?, verifyDocker?}` — valida enums/slug y encola con `--yes`).
- `POST /api/projects/:slug/actions` — `{action: "resume"|"dockerize"|"open-repo"}`: resume encola `--resume <slug> -y`; dockerize re-escribe el `Dockerfile` y corre `docker build` async si hay daemon (estado en `docker-build.json`, log en `docker-build.log`; sin daemon → `skipped`); open-repo devuelve la URL web del remote git.

Los jobs encolados se procesan con `npm run worker` como siempre — la API solo encola, no ejecuta.

## Flags

| Flag | Qué hace |
| --- | --- |
| `--idea "<texto>"` | **Requerido** (o se pregunta en modo interactivo). Descripción de la app. |
| `--scope` | `fullstack` \| `frontend` \| `backend` (default `fullstack`). |
| `--app-type` | `landing` \| `orders` \| `blog` \| `custom`. `landing`/`orders`/`blog` usan plan template (instantáneo); `custom` usa planner LLM. Default: inferido. |
| `--name <slug>` | Nombre del proyecto/dir/repo. Default: slug de la idea (con sufijo si existe). |
| `--arch <id>` | Patrón de arquitectura de los pasos backend: `flat` (default — toda la lógica en `server/routes/`), `mvc` (models + controllers), `layers` (controllers → services → repositories), `feature` (`server/modules/<entidad>/`). Solo aplica si el scope tiene backend; se declara en cada paso backend del plan y persiste en `plan.arch` (resume lo restaura). |
| `--resume <dir\|slug>` | **Reanuda un run** desde su `plan.json` (ruta o nombre en `generated-apps/`). No requiere `--idea` ni `--scope`/`--app-type` (los restaura del plan). Los pasos `done` se saltan, los que no terminaron vuelven a `pending` y el pipeline retoma en el primero pendiente — si están todos hechos, salta a `finalVerify` + QA + finalize. Los flags de deploy (`--github`/`--ghpages`/`--no-push`) aplican igual. |
| `-y` / `--yes` | No pedir confirmación del plan ni preguntas interactivas. |
| `--github` | Tras aprobación del QA: crea el repo en GitHub (REST, `GITHUB_TOKEN`) y pushea `main`. **No** publica Pages por sí solo. |
| `--ghpages` | Publica `dist/` en rama `gh-pages` y activa GitHub Pages (`https://<user>.github.io/<repo>/`). **Requiere `--github`**; solo aplica a scopes con frontend (`frontend`/`fullstack`). |
| `--phone <num>` | WhatsApp del negocio en formato internacional sin `+` (ej. `5491155500000`). Se inyecta en los verticales: landing → botón flotante con mini-form → `wa.me`; orders → checkout del carrito con items+total → `wa.me`. Vacío → placeholder `5491100000000`; si en la app queda vacío, el botón no se renderiza. |
| `--no-push` | Solo commit local, nada remoto. |
| `--keep-going` | Continuar al siguiente paso aunque uno agote reintentos (en vez de `fail`). |
| `--quiet` | Sin reporte por nodo ni actividad de tools (solo resultado/historial final). `status.json` se escribe igual. |
| `--verbose` | Mensajes de los nodos sin truncar (default: 220 chars por línea). |
| `--verify-docker` | En `finalVerify`, corre `docker build -t <slug>:verify .` sobre el `Dockerfile` de la app (cada app generada ya lo trae, junto a `.dockerignore`; frontend-only también `nginx.conf`). Si no hay daemon Docker disponible se omite sin fallar. |

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
- `src/stacks/` — registry declarativo de stacks (`vite-react`, `express-sqlite`): skeleton, comandos de verify, requisitos de `validatePlan` y bullets que los prompts inyectan (`{{stackRules}}`) — una sola fuente para validator y planner.
- `src/arch/` — registry de patrones de arquitectura de backend (`flat`, `mvc`, `layers`, `feature`): `--arch <id>` selecciona; `applyArch` inyecta el patrón en los pasos backend, `plan.arch` persiste para resume, el AGENTS.md de la app generada recibe las reglas del patrón.
- `src/verticals/` — paquetes por tipo de app (`landing`, `orders`, `blog`): `buildPlan()` determinístico; `orders` y `blog` traen overlay `api/` (schema + seed + routes) para el api-skeleton.
- `src/templates/` — `AGENTS.md` (reglas UI + guía de diseño copiadas a cada app), `README.md`, `app-skeleton/` (frontend), `api-skeleton/` (backend Express+SQLite+uploads), `docker/` (Dockerfile por variante + `.dockerignore` + `nginx.conf` para frontend-only).
- `src/verticals/<v>/api/` — overlay de backend por vertical (schema.sql + seed-data.js + routes/) que se copia sobre `server/`.
- `generated-apps/` — apps generadas (**gitignored**, cada una con su repo git).
- `runs/` — logs JSON-RPC de cada sesión Devin (**gitignored**). `npm run report -- <runId|slug>` los resume en markdown (pasos, intentos, duración por sesión, totales) y lo guarda en `runs/<runId>/report.md`; sin args lista los runs recientes.
- `tests/` — suite Vitest del orquestador (`npm test`): validator+verticales, slug, shell, install lazy, semáforo Devin, copyApiSkeleton, ghAuthArgs/sanitize/commit idempotente, parseo del reviewer, serialización ACP (stub `devin` en `tests/fixtures/`), resume. Corre en CI (`.github/workflows/test.yml`) en cada PR y push a main.
- `.github/workflows/test.yml` — CI: `npm test` en PRs y main (Node 22, sin Devin ni secrets).
- `ROADMAP.md` — candidatos y próximos pasos (api-skeleton, tests del orquestador, ejecución asincrónica).

## Qué contiene cada app generada

- `plan.json` — checkpoint con status/attempts por paso.
- `status.json` — último estado reportado del pipeline (nodo, step/totalSteps, lastError).
- `AGENTS.md` — reglas de UI + guía de diseño.
- `README.md` — descripción, cómo levantarlo, crédito a MetaBuilder.
- Repo git propio con commit inicial (remoto con `--github`, Pages además con `--ghpages`).
