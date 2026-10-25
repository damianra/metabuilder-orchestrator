# MetaBuilder — Roadmap v2

## Estado

La v1 está completa y mergeada: pipeline LangGraph end-to-end, verticales
`landing`/`orders`/`blog`/`custom`, `api-skeleton` (Express 5 + SQLite),
semáforo global Devin, pool ACP, cola de jobs, reportes de run,
`validate:pr` automático, CI en PRs. Registro histórico y decisiones:
`docs/archive/ROADMAP-v1.md`.

Post-v2 (oct 2026) el dashboard quedó endurecido: `npm run dashboard`
levanta API+UI+worker (los jobs ya no quedan pending sin consumidor),
logs por job (`jobs/<id>.log` + endpoints + acordeón en el detalle),
detalle con prompt/comandos/runner de tests, runtime de containers
docker **o podman** (engine detectado, build/run/logs por el mismo
binario) y spinners de feedback en acciones async.

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
| ~~4~~ | ~~**API del dashboard**~~ ✅ | Implementado — `src/dashboard/server.js` (`npm run dashboard:api`, 127.0.0.1:4100): `GET /api/projects` + `/:slug` (resumen/detalle con reporte en vivo + repoUrl + dockerBuild), `GET /api/jobs`, `POST /api/runs` (whitelist → args del CLI + `--yes`), `POST /:slug/actions` (`resume`/`dockerize`/`open-repo`; dockerize corre build async → `docker-build.json`+`.log` en la app). `--yes` ahora también salta las preguntas de deploy (un job heredando TTY del worker se colgaría). | M |
| ~~5~~ | ~~**Frontend del dashboard**~~ ✅ | Implementado — `dashboard/` (subpackage Vite+React+Tailwind, proxy `/api`→:4100): form de nueva app con pickers desde `GET /api/options` (registries), lista de proyectos con status/progreso, detalle con pasos + acciones (resume/dockerize/open-repo) + reporte, cola de jobs, polling 4-5s, hash routing. `npm run dashboard` levanta API+UI (`src/dashboard/dev.js`, sin concurrently). | M-L |
| ~~6~~ | ~~**Stack Next.js (frontend)**~~ ✅ | Implementado — `app-skeleton-next/` (Next 15 + React 19 + Tailwind + Vitest + Playwright, `output: 'export'` → `out/`), stack `nextjs` en el registry (`buildDir`, `skeletonDesc`, `agentsStack`, `pagesBaseEnv: PAGES_BASE`), flags `--stack-frontend`/`--stack-backend` → `state` → `plan.stacks` → resume, docker `@OUT_DIR@` + detección por config, `api-skeleton` sirve `dist|out`, Pages re-buildea con `PAGES_BASE=/<repo>`, pickers de stack en el dashboard (`POST /api/runs` acepta `stackFrontend`/`stackBackend`). | L |
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
