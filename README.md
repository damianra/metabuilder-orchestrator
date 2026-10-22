# MetaBuilder — Orquestador de desarrollo con agentes

Generador de aplicaciones básicas (landing pages, webs de pedidos, blogs, etc.) orquestado con **LangGraph** que delega la escritura de código a **Devin CLI** en modo headless.

## Arquitectura

```
preflight → plan → validate ─┬─→ build → verify ─┬─→ (siguiente paso)
                             │                   ├─→ finalVerify → finalize
                             └─→ repairPlan      └─→ fix → verify
```

- **LangGraph** mantiene el estado de la orquestación en memoria local (`src/orchestrator/`).
- **Devin CLI** (`devin -p`, modo `dangerous`, cwd acotado al proyecto) escribe el código de cada paso.
- `plan.json` dentro del proyecto generado actúa como checkpoint (status/attempts por paso).
- Verificación real por paso: cada paso declara un comando `verify` (`npm run build`, `npx vitest run`, `npm run test:e2e`...).

## Stack de las apps generadas

- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express
- BD: SQLite (archivo local)
- Testing: Vitest + Playwright (E2E, solo si hay frontend)

## Requisitos

- Node.js >= 20, npm, git
- [Devin CLI](https://devin.ai) instalado y autenticado:

```bash
devin auth login          # una sola vez; el token persiste en ~/.local/share/devin/credentials.toml
devin models list         # probe: exit 0 = autenticado
```

## Uso

```bash
cp .env.example .env      # configurar GIT_USER_*, GITHUB_REPO_URL (opcional)
npm install

npm start -- --idea "landing page para una cafetería" --scope frontend
npm start -- --idea "web de pedidos con carrito"               # scope default: fullstack
npm start                                                    # modo interactivo
```

### Flags

| Flag | Descripción |
| --- | --- |
| `--idea <texto>` | Descripción de la app a generar |
| `--scope` | `fullstack` \| `frontend` \| `backend` (default `fullstack`) |
| `--name <slug>` | Nombre del proyecto (default: inferido de la idea) |
| `--no-push` | Solo commit local, no pushear aunque haya `GITHUB_REPO_URL` |
| `--keep-going` | Continuar aunque un paso falle tras los reintentos |

## Estructura

- `src/index.js` — entrada CLI
- `src/orchestrator/` — grafo LangGraph y estado
- `src/agents/` — nodos: preflight, planner, validator, builder, verifier, fixer, finalizer
- `src/tools/` — wrappers: devin CLI headless, shell, slug
- `src/prompts/` — plantillas de prompts
- `src/templates/AGENTS.md` — reglas de UI/stack copiadas a cada app generada
- `generated-apps/` — salida (gitignored, cada app con su propio repo)
- `runs/` — logs y exports de sesiones Devin (gitignored)
