# MetaBuilder — Roadmap v2

## Estado

La v1 está completa y mergeada: pipeline LangGraph end-to-end, verticales
`landing`/`orders`/`blog`/`custom`, `api-skeleton` (Express 5 + SQLite),
semáforo global Devin, pool ACP, cola de jobs, reportes de run,
`validate:pr` automático, CI en PRs. Registro histórico y decisiones:
`docs/archive/ROADMAP-v1.md`.

## Visión v2

**Dashboard de control**: una UI propia para lanzar generaciones sin CLI,
elegir stack y arquitectura, y supervisar `generated-apps/` (estado de
plan, último reporte, acciones como resume/dockerize). Además,
**arquitectura elegible**: el backend generado no debe salir
"desorganizado" — el usuario elige el patrón (capas, por feature, etc.)
y el plan lo impone. Y **dockerización bajo demanda**: cada app sale con
`Dockerfile`, y el dashboard dispara el build cuando se quiera.

## Backlog priorizado

Ordenado por dependencia: lo que habilita lo demás va primero.

| # | Tarea | Descripción | Esfuerzo |
| --- | --- | --- | --- |
| ~~1~~ | ~~**Registry de stacks**~~ ✅ | Implementado — `src/stacks/` declarativo (`vite-react`, `express-sqlite`): skeleton, verify, requirements con `error`+`prompt`, fragmentos de README. `resolveStacks`/`planRequirements`/`finalCheckCommands`/`stackRuleBullets`; validator, preflight, finalizer, fixer y prompts (`{{stackRules}}`) leen del registry. | M |
| ~~2~~ | ~~**Patrones de arquitectura de backend**~~ ✅ | Implementado — `src/arch/` (flat/mvc/layers/feature), flag `--arch`, `applyArch` inyecta el patrón en pasos backend, `plan.arch` persiste, validator exige la mención, AGENTS.md de la app recibe las reglas. *(Hexagonal evaluado y descartado: en JS puro los ports son convención sin enforcement — el código generado quedaría nominalmente hexagonal pero idéntico a "por capas" con otros nombres de carpeta.)* | M |
| ~~3~~ | ~~**Dockerfile por app**~~ ✅ | Implementado — `src/tools/docker.js` + `src/templates/docker/` (backend/fullstack/frontend + `.dockerignore` + `nginx.conf`), preflight lo escribe por scope (o filesystem en resume), `api-skeleton/app.js` sirve `dist/` + SPA fallback, flag `--verify-docker` corre `docker build` en finalVerify si hay daemon. | S-M |
| **4** | **API del dashboard** | `src/dashboard/server.js` — Express en el orquestador (no en las apps): `GET /api/projects` (lista `generated-apps/` con status de `plan.json`/`status.json`/reporte), `GET /api/projects/:slug` (detalle + `report.md`), `POST /api/runs` (encola vía `src/queue.js` existente — idea + scope + stack + arch + flags), `POST /api/projects/:slug/actions` (`resume`, `dockerize`, `open-repo`). Puerto propio (ej. 4100). La cola ya existe: el dashboard es una capa fina encima. | M |
| **5** | **Frontend del dashboard** | UI en el propio repo (Vite+React+Tailwind — dogfooding del skeleton): formulario de nueva app (idea, scope, pickers de stack/arquitectura), lista de proyectos con estado + último reporte, vista de detalle con pasos y logs. `npm run dashboard` levanta API + UI. | M-L |
| **6** | **Stack Next.js (frontend)** | Nuevo `app-skeleton-next` (Next + Tailwind + Vitest), registrado vía el registry de la tarea #1. GitHub Pages solo con `output: 'export'` (o se deshabilita Pages para este stack). El e2e Playwright se mantiene igual. | L |
| **7** | **orders con delivery real** (heredado de v1) | Costo por zona/mapa, persistir pedido en Sheets, panel admin. Sigue fuera del scope "apps básicas" — retomar cuando el dashboard esté andando. | — |

## Evaluación futura (fuera del roadmap por ahora)

- **NestJS**: el patrón auto-mount de routes no aplica (Nest usa
  módulos + decorators) — el paso backend "generativo-lite" habría que
  repensarlo. Cambio a grandes rasgos.
- **Expo (Android)**: cambia el modelo de verificación completo (no hay
  `npm run build` web ni Playwright — verify sería `tsc`+vitest, E2E
  requeriría Maestro, deploy real = EAS Build con credenciales).
  Cambio a grandes rasgos.

## Decisiones pendientes

- **Dashboard en este repo o app aparte** → recomendado: en este repo
  (reutiliza `queue.js`, `report.js`, `status.json` sin abstraer nada;
  la UI es un consumidor más de la cola).
- **Docker runtime en el orquestador** → generar `Dockerfile` siempre;
  el `docker build` solo bajo demanda (flag o acción del dashboard) —
  no atar la generación a tener daemon corriendo.
- **Patrones de arquitectura a ofrecer** → set acordado: flat
  (actual), MVC clásico, por capas, por feature. Hexagonal descartado
  (ver nota en #2).
