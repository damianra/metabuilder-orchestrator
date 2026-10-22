# MetaBuilder — Orquestador de desarrollo con agentes

MetaBuilder convierte una idea en texto libre en una aplicación funcionando (landing pages, webs de pedidos con carrito y WhatsApp, blogs, etc.) mediante un **harness multi-agente construido sobre LangGraph**: un orquestador determinístico coordina sub-agentes que escriben el código con **Devin CLI via ACP**. La arquitectura es **híbrida** — cada tarea la ejecuta el recurso más barato capaz de resolverla: código local para lo predecible (planes por vertical, copia del skeleton, validación del plan, verificaciones, git/README/deploy) y **sesiones Devin solo para lo generativo** (un builder por paso del plan, un fixer que recibe el stderr real del fallo, y un revisor QA que aprueba o rechaza la app terminada). Cada paso corre en su propia sesión aislada y el estado vive en `plan.json` + el filesystem, con lo que el pipeline puede reintentar, reanudar y pedir aprobación del plan antes de gastar una sola llamada al agente. Los beneficios: una app lista en ~5 minutos y pocas sesiones en lugar de un agente pesado por tarea; fallos acotados al paso que los causó con reparación dirigida; verificaciones reales (build + tests + e2e) como compuertas entre etapas; y un humano en el loop (plan → aprobar → construir) que evita desperdiciar trabajo en planes equivocados.

## Cómo funciona

```
preflight → planner → validate ─┬─→ confirm → builder → verify ─┬─→ builder (siguiente paso)
                                │                               ├─→ finalVerify → review ─┬─→ finalize → END
                                └─→ repairPlan                  └─→ fixer → verify        └─→ fixer
```

| Nodo | Qué hace |
| --- | --- |
| `preflight` | Chequea binarios + auth Devin (ACP), crea `generated-apps/<slug>/`, copia `AGENTS.md` y — si el tipo es un vertical con frontend — copia el **skeleton** (Vite+React+Tailwind+Vitest+Playwright) y corre `npm install`. |
| `planner` | Genera `plan.json`. Si `appType` es un **vertical conocido** (`landing`, `orders`) usa un template determinístico (**sin llamar a Devin**); si es `custom`, una sesión Devin ACP lo escribe. Si ya existe `plan.json`, lo reutiliza (resume). |
| `validate` | Validación 100% local del plan (schema, tipos de paso, `verify` ejecutable, requisitos por scope). |
| `confirm` | `interrupt()` de LangGraph: muestra el plan y espera `[S/n]` — solo en TTY y sin `--yes`. |
| `builder` | Una sesión Devin ACP por paso (`prompts/builder.md`). Pasos `infra` con skeleton ya copiado no consumen Devin. |
| `verify` | Corre el comando `verify` del paso dentro del proyecto (`execa`, nunca lanza). |
| `fixer` | Si verify falla: manda a Devin la descripción del paso + stderr (`prompts/fixer.md`). Máx `MAX_STEP_RETRIES` (3) intentos. |
| `finalVerify` | Batería por scope: `npm run build` + `npx vitest run` + `npm run test:e2e` (solo si hay frontend; backend → solo vitest). |
| `review` | Sub-agente QA: sesión Devin revisa la app contra `AGENTS.md` y la idea (`prompts/reviewer.md`). `RESULT: APPROVED` → finalize; `RESULT: ISSUES` → fixer. |
| `finalize` | Genera `README.md` (descripción + cómo levantarlo + crédito a MetaBuilder), `git init/commit`, y push según modo. |
| `repairPlan` / `fail` | Reparación del plan (máx `MAX_PLAN_RETRIES`=2, solo errores de contenido) / terminación en `failed`. |

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

## Flags

| Flag | Qué hace |
| --- | --- |
| `--idea "<texto>"` | **Requerido** (o se pregunta en modo interactivo). Descripción de la app. |
| `--scope` | `fullstack` \| `frontend` \| `backend` (default `fullstack`). |
| `--app-type` | `landing` \| `orders` \| `custom`. `landing`/`orders` usan plan template (instantáneo); `custom` usa planner LLM. Default: inferido. |
| `--name <slug>` | Nombre del proyecto/dir/repo. Default: slug de la idea (con sufijo si existe). |
| `-y` / `--yes` | No pedir confirmación del plan ni preguntas interactivas. |
| `--github` | Tras aprobación del QA: crea el repo en GitHub (REST, `GITHUB_TOKEN`) y pushea `main`. **No** publica Pages por sí solo. |
| `--ghpages` | Publica `dist/` en rama `gh-pages` y activa GitHub Pages (`https://<user>.github.io/<repo>/`). **Requiere `--github`**; solo aplica a scopes con frontend (`frontend`/`fullstack`). |
| `--phone <num>` | WhatsApp del negocio en formato internacional sin `+` (ej. `5491155500000`). Se inyecta en los verticales: landing → botón flotante con mini-form → `wa.me`; orders → checkout del carrito con items+total → `wa.me`. Vacío → placeholder `5491100000000`; si en la app queda vacío, el botón no se renderiza. |
| `--no-push` | Solo commit local, nada remoto. |
| `--keep-going` | Continuar al siguiente paso aunque uno agote reintentos (en vez de `fail`). |

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

## Requisitos

- Node.js >= 20, npm, git.
- **Devin CLI** autenticado vía cuenta Windsurf: `~/.local/share/devin/credentials.toml` con `windsurf_api_key` (lo escribe Devin Desktop). El orquestador usa `devin acp` (mismo canal que Devin Desktop) — **`devin -p`/`auth status` reportan "Not logged in" con estas credenciales y NO son la vía**.
- Playwright Chromium: se instala una vez en `~/.cache/ms-playwright` (compartido entre apps).

## Estructura

- `src/index.js` — CLI (flags + modo interactivo + loop de confirmación).
- `src/orchestrator/` — `state.js` (canales) + `graph.js` (routing + checkpointer).
- `src/agents/` — nodos: preflight, planner, validator, confirm, builder, verifier, fixer, reviewer, finalizer.
- `src/tools/` — `devin.js` (cliente ACP), `shell.js` (execa), `slug.js`, `github.js` (REST).
- `src/prompts/` — builder/fixer/planner/plan-repair/reviewer.md.
- `src/verticals/` — paquetes por tipo de app (`landing`, `orders`): `buildPlan()` determinístico.
- `src/templates/` — `AGENTS.md` (reglas UI + guía de diseño copiadas a cada app), `README.md`, `app-skeleton/`.
- `generated-apps/` — apps generadas (**gitignored**, cada una con su repo git).
- `runs/` — logs JSON-RPC de cada sesión Devin (**gitignored**).

## Qué contiene cada app generada

- `plan.json` — checkpoint con status/attempts por paso.
- `AGENTS.md` — reglas de UI + guía de diseño.
- `README.md` — descripción, cómo levantarlo, crédito a MetaBuilder.
- Repo git propio con commit inicial (remoto con `--github`, Pages además con `--ghpages`).
