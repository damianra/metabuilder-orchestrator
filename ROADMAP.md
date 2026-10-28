# MetaBuilder — Roadmap v9

## Estado

v1–v8 completas y mergeadas: pipeline LangGraph end-to-end, verticales
`landing`/`orders`/`blog`/`custom`, `api-skeleton` (Express 5 + SQLite),
registry de stacks/arch/compliance, engines ACP intercambiables
(Devin/OpenCode) con setup gate, dashboard completo (cola, terminal,
notificaciones, publish async) y pestaña "Diseñar app" (backend +
UI tabs + idle-parking del preview). Registro histórico:
`docs/archive/ROADMAP-v1..v3.md` y `docs/archive/ROADMAP-v4-v8.md`.

## Visión v9

De **"diseño y backend como flujos separados"** a **"piezas
componibles"**: el diseño iterado en chat se guarda como app frontend
real (ya existe) y después se le puede **agregar backend sobre el mismo
proyecto** (`--extend`) → una sola app fullstack con repo, docker y
Pages como cualquier otra. El chat de diseño gana **propuestas
estructuradas**: el agente pide validación al usuario y ofrece
acciones clickeables (guardar, generar backend, seguir iterando) en
lugar de adivinar.

## Backlog v9 — componibilidad diseño↔backend — todo mergeado

| # | Tarea | Descripción | Esfuerzo |
| --- | --- | --- | --- |
| 1 ✅ | **`--extend <slug>` end-to-end** — agregar backend a un proyecto frontend existente. Flag → resumeDir + `state.extend`; preflight copia `copyApiSkeleton` si falta `server/` (mergea sobre el frontend, nunca pisa); rama extend en planner con `prompts/extend-backend.md` (el agente lee el frontend y appendea pasos backend + integración frontend↔API + test + e2e); `normalizeExtendedPlan` determinístico post-agente (scope→fullstack, stacks, `validated=false`, patch de descripciones, renumeración). Fixes base incluidos: validator honra `plan.validated` (estructura sí, requirements no — salva el resume de diseños sin repairPlan) y `saveDesign` escribe descripción compliant (keywords vite/ui). Acción `add-backend` en `POST /api/projects/:slug/actions` que encola `--extend`. | L |
| 2 ✅ | **Propuestas en el chat de diseño** — contrato `proposal` en `designer.md`: bloque fenced JSON `{question, options:[{label, reply?, action?}]}` al final del reply cuando el agente necesita validación o quiere ofrecer próximos pasos; `DesignTab` lo parsea y renderiza card con botones (`reply` → envía como mensaje, `action` → nativa: save/extend/preview). Fallback a texto plano si el JSON no parsea. Guard-rails: solo mensajes del agente, máx 4 opciones, actions desconocidas → reply. | M |
| 3 ✅ | **Dashboard extend + API surface** — botón "agregar backend" en `ProjectDetail` visible solo si `plan.scope === 'frontend'` → modal (idea del backend, arch, flags github/ghpages) → action `add-backend`; oferta "generar backend" tras guardar un diseño; `GET /api/projects/:slug/api-surface` (scan regex de `server/routes/*.js`) + tabla método+ruta en el detalle con "probar" contra el dev-run :4000; wiring del `action:"extend"` del chat al modal. | M |

## Backlog v10 — composición bidireccional (backend ↔ diseño)

Decisión: cada pestaña construye UNA pieza — "Crear" genera **backend**
(default) o **fullstack rápido** (one-shot intacto); "Diseñar app"
genera el **front**. La composición va en ambas direcciones:
front→backend ya existe (v9 `--extend`); la novedad es backend→front
(diseñar la UI contra la API real).

| # | Tarea | Descripción | Esfuerzo |
| --- | --- | --- | --- |
| 1 | **Tab "Crear" → backend/fullstack** — el scope picker pierde `frontend` (Diseñar es el mejor flujo front). Form con `backend` (default: api-skeleton + overlay del vertical + arch + compliance) o `fullstack` (one-shot actual). Pickers front-only (stack-frontend, compliance-UI) se muestran solo con scope que lleva front. Clone ("Nueva app igual") oculto en proyectos frontend. CLI `--scope frontend` se conserva para retrocompat (resume/planes viejos). | S |
| 2 | **Backend → Diseñar app (attach)** — DesignTab con context picker "diseñar para `<backend-slug>`": `POST /api/design {for: slug}` persiste `attachTo` en design-state; `designChat` inyecta la `api-surface` del backend en el prompt (el agente construye la UI contra endpoints reales, sin mocks ni paso de integración); el vite del design-work ya proxea `/api`→`:4000` → preview contra la API real si el dev-run del backend corre. **Guardar = attach**: `saveDesign` copia el front dentro del proyecto backend (`src/`, `index.html`, configs, tests + merge de package.json por clave), `plan.scope→fullstack`, `stacks.frontend`, step `done` sintético, AGENTS.md re-escrito por detección; 409 si ya tiene `src/`/`index.html` o job running. | M-L |
| 3 | **Lifecycle del api dev-run durante el diseño** — chip en DesignTab con el estado del `:4000` del backend attachado + botón levantar/frenar (reusa `run-dev`/`stop-dev` actions sobre ese slug). | S |

## Heredado (sigue fuera de scope)

- **orders con delivery real**: costo por zona/mapa, persistir pedido en
  Sheets, panel admin.

## Evaluación futura (fuera del roadmap por ahora)

- **Dry-run del extender con preview del plan**: corre solo la sesión
  del extender → UI muestra pasos/endpoints propuestos → "ejecutar"
  encola el extend real (el plan ya quedó escrito → resume lo reusa).
- **Aprobación de plan en dashboard**: el nodo `confirm` usa
  `interrupt()` solo en TTY del CLI; exponerlo a la API exige proceso
  vivo + IPC.
- **Más engines ACP**: `claude-code`, `gemini-cli` — si hablan ACP v1
  entran como datos en `src/engines/` sin tocar el pipeline.
- **Chat nativo (ACP) en lugar de terminal embebida**: chat propio
  sobre `session/prompt` con diffs y permisos visibles.
- **`session/resume`/`session/load` de opencode** para darle contexto
  entre pasos del builder.
- **NestJS / Expo**: cambian contratos de verify/deploy.

## Decisiones tomadas (v9)

- **`plan.validated` es confianza, no solo cache**: lo escribe el
  validator al pasar y `saveDesign` al emitir el plan sintético. El
  validator lo honra saltando requirements de completitud (los pasos
  ya están construidos) pero nunca el chequeo estructural — un plan
  corrupto igual frena en schema. Extend lo resetea a `false`: el plan
  fusionado se re-valida completo.
- **Extend = resume + inyección de pasos, no pipeline nuevo**: el
  agente appendea pasos a plan.json y toda la maquinaria existente
  (validate → builder → verify → review → finalize) corre sin cambios.
  La normalización post-agente es determinística porque el LLM no es
  confiable para metadatos (`applyArch`/`applyCompliance` son la red
  de seguridad, igual que en `repairPlan`).
- **El paso de integración es obligatorio en el plan extendido**: un
  frontend de chat trae datos mock — sin un step `frontend` que
  reemplace mocks por `fetch('/api/*')` quedan dos mitades
  desconectadas.
- **Propuestas = texto dentro del stream, no protocolo ACP**: el chat
  de diseño es protocolo propio (SSE); un bloque ` ```proposal ` en la
  respuesta lo parsea la UI. Cero cambios de contrato server↔agente;
  si el agente no lo emite o sale malformado, degrada a texto.
- **Skeleton por detección, no por flag**: preflight extend copia
  api-skeleton solo si `server/` no existe — re-correr extend sobre un
  proyecto fullstack es no-op de scaffold (AGENTS.md y Dockerfile ya
  se re-escriben por detección de contenido, como en resume).
