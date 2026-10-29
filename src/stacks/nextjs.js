/**
 * Stack frontend: Next.js (App Router) + Tailwind + Vitest + Playwright.
 * `output: 'export'` → `out/` estático: Pages-compatible y servible por
 * el Express del api-skeleton en el contenedor fullstack. `buildDir`
 * distinto al de vite-react ('dist') — finalizer/docker lo leen de acá.
 * `pagesBaseEnv`: el finalize re-buildea con esta env var = /<repo>
 * para que el export salga con basePath correcto en Pages.
 */
import { hasMarker } from './helpers.js';

export default {
  id: 'nextjs',
  kind: 'frontend',
  label: 'Next.js + React + Tailwind',
  skeletonDir: 'app-skeleton-next',
  skeletonDesc: 'Next.js (App Router, static export) + Tailwind + Vitest + Playwright',
  agentsStack: 'Next.js (App Router, `output: "export"` → `out/`) + React + Tailwind CSS',
  buildDir: 'out',
  pagesBaseEnv: 'PAGES_BASE',

  // Mismos comandos que vite-react: `npm run build` = `next build`.
  toolchain: {
    manifest: 'package.json',
    installCmd: 'npm install',
    buildCmd: 'npm run build',
    testCmd: 'npx vitest run',
    e2eCmd: 'npm run test:e2e',
    devCmd: 'npm run dev',
    devPort: 3000,
  },

  // Si un dir trae vite.config y next.config a la vez, gana next
  // (su export a out/ es la variante más restrictiva).
  detectPriority: 10,
  detect: (dir) => hasMarker(dir, /^next\.config\.(m?js|ts)$/),

  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['next'],
      error: 'falta paso de init Next.js+Tailwind',
      prompt: 'Debe incluir un paso de init Next.js+Tailwind (que mencione "Next").',
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
      type: 'frontend',
      keywords: ['privacidad', 'consentimiento'],
      error:
        'algún paso frontend debe declarar la página de privacidad y el consentimiento en formularios con datos personales',
      prompt:
        'Algún paso `frontend` debe declarar la página de privacidad y el checkbox de consentimiento en formularios con datos personales (reglas de privacidad del `AGENTS.md`).',
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

  readme: {
    stack: '- Next.js (App Router, export estático) + Tailwind CSS (frontend)',
    e2eSuffix: ' + Playwright + Chromium (E2E)',
    dev: 'npm run dev        # frontend en http://localhost:3000',
    tests: ['npm run test:e2e   # E2E Playwright (Chromium)'],
  },
};
