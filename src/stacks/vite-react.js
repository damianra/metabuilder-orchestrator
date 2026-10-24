/**
 * Stack frontend: Vite + React + Tailwind + Vitest + Playwright.
 * Definición declarativa — validator, preflight, finalizer y los
 * prompts del planner leen de acá. Agregar un stack frontend nuevo =
 * un archivo así + registro en src/stacks/index.js.
 */
export default {
  id: 'vite-react',
  kind: 'frontend',
  label: 'Vite + React + Tailwind',
  skeletonDir: 'app-skeleton',

  // Comandos de finalVerify (también los verify canónicos de los pasos).
  verify: {
    build: 'npm run build',
    test: 'npx vitest run',
    e2e: 'npm run test:e2e',
  },

  /**
   * Requisitos que validatePlan impone sobre plan.json.
   * - check 'some': al menos un paso (del `type` indicado, o cualquiera
   *   si null) menciona todas las `keywords` en description+verify.
   * - check 'each': TODO paso de ese `type` debe mencionarlas.
   * `error` = mensaje del validador; `prompt` = bullet equivalente
   * para planner.md/plan-repair.md (misma regla, una sola fuente).
   */
  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['vite'],
      error: 'falta paso de init Vite+React+Tailwind',
      prompt: 'Debe incluir un paso de init Vite+React+Tailwind (que mencione "Vite").',
    },
    {
      check: 'some',
      type: 'e2e',
      keywords: ['playwright'],
      error: 'falta paso e2e con Playwright',
      prompt:
        'Debe incluir un paso `type: "e2e"` con Playwright cuyo verify sea `npm run test:e2e`.',
    },
    {
      check: 'each',
      type: 'frontend',
      keywords: ['ui'],
      error: 'los pasos frontend deben mencionar las reglas de UI',
      prompt:
        'Los pasos `frontend` deben mencionar explícitamente que aplican las reglas de UI del `AGENTS.md` de este directorio.',
    },
    {
      check: 'some',
      type: 'test',
      keywords: ['vitest'],
      error: 'falta paso test con Vitest',
      prompt:
        'Al menos un paso `type: "test"` que configure Vitest con verify `npx vitest run` o `npm test`.',
    },
  ],

  // Fragmentos que writeReadme (finalizer) compone en el README de la app.
  readme: {
    stack: '- React + Vite + Tailwind CSS (frontend)',
    e2eSuffix: ' + Playwright + Chromium (E2E)',
    dev: 'npm run dev        # frontend en http://localhost:5173',
    tests: ['npm run test:e2e   # E2E Playwright (Chromium)'],
  },
};
