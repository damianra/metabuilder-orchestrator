# MetaBuilder — Roadmap v3

## Estado

v1 y v2 completas y mergeadas: pipeline LangGraph end-to-end,
verticales `landing`/`orders`/`blog`/`custom`, `api-skeleton` (Express 5
+ SQLite), registry de stacks (`vite-react`, `nextjs`, `express-sqlite`),
patrones de arquitectura de backend (`flat`/`mvc`/`layers`/`feature`),
Dockerfile por app, dashboard funcional (form + lista + detalle + cola),
worker auto-consumidor en `npm run dashboard`, logs por job, runner de
tests, runtime de containers docker/podman y feedback visual en acciones
async. Registro histórico: `docs/archive/ROADMAP-v1.md` y
`docs/archive/ROADMAP-v2.md`.

## Visión v3

De **"generar una vez"** a **"iterar y operar"**. La v2 entregó el
scaffolding supervisado; la v3 convierte al dashboard en el lugar donde
la app sigue viva después del run: una terminal Devin por proyecto para
pedir cambios en lenguaje natural, visibilidad de lo que el agente hace
en tiempo real, control sobre jobs (cancelar/reintentar), correr apps
sin containers, y housekeeping (borrar proyectos, doctor de prereqs).

## Backlog priorizado

Ordenado por valor/dependencia: la terminal Devin es la flagship — todo
lo demás es observabilidad, control o housekeeping alrededor del run.

| # | Tarea | Descripción | Esfuerzo |
| --- | --- | --- | --- |
| 1 | **Terminal Devin embebida en el dashboard** | Sección "Terminal Devin" en el detalle de cada proyecto: botón "Abrir sesión" que spawnea `devin` (CLI interactivo) con cwd en `generated-apps/<slug>/` — el usuario chatea con Devin directamente sobre el repo de la app y le pide cambios. Backend: `node-pty` (spawn con PTY real — el TUI de devin lo requiere) + WebSocket (`ws`) en la API del dashboard (`/api/projects/:slug/terminal`); la UI usa xterm.js + fit addon. Respetar el semáforo `devin-lock.js`: la sesión interactiva adquiere un slot como cualquier `runDevinPrompt` (si una generación está corriendo, mostrar "esperando slot"). Una sesión por slug; kill del pty al cerrar. Solo se permiten dirs dentro de `generated-apps/` (la API sigue bindeando 127.0.0.1). Opcional: botón "Verificar" post-sesión que reusa el runner de tests. `node-pty` es dep nativa — documentar fallback si no compila. | L |
| 2 | **Feed en vivo de la actividad del agente** | Hoy entre "builder paso N empezó" y "terminó" hay minutos de caja negra — `runs/<id>/` ya guarda los `agent_message_chunk` JSON-RPC. Condensarlos (texto del agente + tool calls resumidos) en el log del job o en un stream SSE que el acordeón "Log del run" muestre mientras el job corre. | M |
| 3 | **Cancelar jobs** | Acción por job: `pending` → borrar de la cola; `running` → matar el árbol de procesos del `npm start` (cuidando no dejar hijos Devin huérfanos) + marcar el job `cancelled`. Botón en QueuePanel y en el detalle del proyecto afectado. | M |
| 4 | **Correr la app en dev sin containers** | Acción `run-dev` que spawnea `npm run dev`/`npm run api` de la app (state + log persistidos estilo test-run), expone la URL local (5173/4000) y permite detenerla. Para máquinas sin docker/podman y para desarrollo interactivo post-terminal. | M |
| 5 | **Eliminar proyecto** | Acción `delete` en el detalle con confirmación: `rm -rf generated-apps/<slug>/` + cleanup del container e imagen `<slug>:local` si existen. `generated-apps/` se llena de pruebas descartables. | S |
| 6 | **Reintentar job fallido** | Botón "Reintentar" en QueuePanel/detalle que re-encola los mismos args. `resume` cubre apps con `plan.json`; un job que murió en preflight no deja app y hoy hay que reescribir la idea a mano. | S |
| 7 | **Request logging en api-skeleton** | Middleware propio (~10 líneas, sin morgan) que loguee `método path status ms` por request. Sin esto `podman logs`/`docker logs` solo muestra el listen — la feature de container logs queda inútil para apps con backend. | S |
| 8 | **Notificación al terminar un run** | `Notification` del browser (permiso on-demand) cuando un job pasa a done/failed mientras la pestaña está en background. | S |
| 9 | **Clonar configuración** | Botón en el detalle "Nueva app igual" → pre-llena el form con scope/vertical/arch/stacks del proyecto (idea vacía). Caso real: mismo setup, otro rubro. | S |
| 10 | **`npm run doctor`** | Chequeo standalone de prereqs (node/npm, auth Devin, playwright browsers, docker/podman, gh) sin encolar nada — separa "mi máquina está lista" de "el job arrancó y falló en preflight". | S |

## Pulido (cola de nits acumulados)

- `queue clear` no borra los `.log` huérfanos de jobs eliminados.
- `?tail` con valores negativos no se clampea (jodería offsets).
- Algunos log streams sin handler `error` explícito.
- **`--verify-docker` sigue siendo docker-only** — documentado así; la
  paridad con podman (~probe `podman info` + mismo comando) es un fix
  chico pendiente.
- Lista de proyectos sin búsqueda/filtro — no duele hoy, agregar cuando
  `generated-apps/` crezca.

## Heredado de v2 (sigue fuera de scope)

- **orders con delivery real**: costo por zona/mapa, persistir pedido en
  Sheets, panel admin. Retomar cuando la ola de dashboard se asiente.

## Evaluación futura (fuera del roadmap por ahora)

- **Chat Devin nativo (ACP) en lugar de terminal embebida**: la terminal
  del ítem 1 es la vía barata (reusa el TUI de `devin`). La alternativa
  rica es un chat propio sobre ACP (`session/prompt` + chunks
  estructurados, diffs, permisos visibles) — mucho más trabajo pero UI
  nativa. Evaluar después de validar que la terminal cubre el caso.
- **NestJS**: el patrón auto-mount de routes no aplica (Nest usa
  módulos + decorators) — el paso backend generativo-lite habría que
  repensarlo. Cambio a grandes rasgos.
- **Expo (Android)**: cambia el modelo de verificación completo (no hay
  `npm run build` web ni Playwright — verify sería `tsc`+vitest, E2E
  requeriría Maestro, deploy real = EAS Build con credenciales).
  Cambio a grandes rasgos.

## Decisiones pendientes

- **node-pty vs alternativa sin dep nativa**: `node-pty` necesita
  toolchain de compilación en algunas plataformas; si pesa, plan B =
  `script(1)` (pty vía comando del sistema) o chat ACP (ver evaluación).
- **Terminal Devin y semáforo**: una sesión interactiva ocupa el único
  slot por defecto (`MAX_CONCURRENT_DEVIN_SESSIONS=1`) — decidir si se
  permite subirlo a 2 para dashboard+worker en paralelo, o si la
  terminal espera/avisada cuando hay generación en curso.
