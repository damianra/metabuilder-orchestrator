const step = (id, type, description, verify) => ({
  id,
  type,
  description,
  verify,
  status: 'pending',
  attempts: 0,
});

const infraFrontend = step(
  1,
  'infra',
  'El proyecto ya contiene el skeleton base (Vite + React + Tailwind + Vitest + Playwright) instalado por el orquestador. Verificar que `npm run build` compila; si falta node_modules ejecutar `npm install` primero. NO reestructurar la config base.',
  'npm run build',
);

const e2eBlog = (n) =>
  step(
    n,
    'e2e',
    'Escribir specs Playwright en e2e/ (chromium; playwright.config.js ya configurado): la página carga sin errores de consola, la lista de posts se ve, el filtro por categoría funciona, el detalle del post abre (o navega a /post/<slug>), el formulario de comentario está deshabilitado hasta que autor y texto son válidos, y la lista vacía de posts muestra fallback informativo. Para aislar el e2e del backend, mockear las rutas /api/* con page.route (respuestas JSON fijas: posts, categories, comments). Instalar el browser con `npx playwright install chromium` si hace falta.',
    'npm run test:e2e',
  );

const vitestStep = (n, extra = '') =>
  step(
    n,
    'test',
    `Escribir tests con Vitest + Testing Library (jsdom ya configurado) cubriendo: la lista de posts renderiza títulos/excerpts y fallback con lista vacía, el filtro por categoría, y el formulario de comentario deshabilitado por defecto y habilitado con datos válidos.${extra}`,
    'npx vitest run',
  );

function backendStep(n, idea) {
  return step(
    n,
    'backend',
    'El proyecto ya tiene el api-skeleton instalado: Express 5 + SQLite (better-sqlite3) en server/, auto-mount de server/routes/*.js en /api/*, static /uploads y POST /api/uploads (multer). El overlay del vertical ya proveyó server/schema.sql (posts, categories, tags, post_tags, comments), server/seed-data.js y las routes posts/categories/tags/comments. ' +
      `Personalizar server/seed-data.js según la idea del usuario: "${idea}" — temática del blog, posts reales del tema con título/excerpt/body propios (ids explícitos para las relaciones post_tags y comments), categorías con slug, tags coherentes y 1-2 comentarios aprobados de ejemplo. ` +
      'Agregar routes/endpoints extra SOLO si la idea los pide (un archivo nuevo en server/routes/ se monta solo en /api/<nombre>). NO tocar server/db.js, server/app.js ni la convención de auto-mount. ' +
      'Express y SQLite ya están configurados — no reinstalar ni reestructurar. Agregar tests Vitest en server/ cubriendo GET /api/posts, GET /api/posts/:slug, GET /api/categories y POST /api/comments.',
    'npx vitest run',
  );
}

function frontendStep(n, { withApi, idea }) {
  return step(
    n,
    'frontend',
    `Implementar el blog en React + Tailwind sobre el skeleton. Idea del usuario: "${idea}". ${
      withApi
        ? 'Todo el contenido viene de la API: GET /api/posts (lista con paginación/filtros), GET /api/posts/:slug (detalle con body, tags y comentarios aprobados), GET /api/categories y GET /api/tags (filtros), POST /api/comments para comentar. Fallback informativo si la API falla o devuelve vacío.'
        : 'Los posts usan datos locales en src/data/posts.js.'
    } ` +
      'Secciones: lista de posts con cover_image/excerpt/categoría/tags/fecha, filtro por categoría y por tag, buscador, detalle del post con comentarios aprobados + formulario de comentario (avisar que queda pendiente de moderación, no renderizarlo al instante), navbar y footer del blog. ' +
      'Contenido no provisto → lorem ipsum / placeholders. Cumplir todas las reglas de UI de AGENTS.md: formulario deshabilitado hasta datos válidos, fallback informativo si la lista viene vacía o la API falla, cover_image vacía → sin imagen rota.',
    'npm run build',
  );
}

/**
 * Blog con posts, categorías, tags y comentarios moderados.
 * scope: 'fullstack' | 'frontend' (mock) | 'backend' (solo API).
 */
export function buildPlan({ projectName, idea, scope = 'fullstack' }) {
  const steps = [];

  if (scope === 'backend') {
    steps.push(
      backendStep(1, idea),
      step(
        2,
        'test',
        'Ampliar tests Vitest de la API: GET /api/posts devuelve {items,total} con paginación y filtros, GET /api/posts/:slug devuelve el post o 404, POST /api/comments valida campos y queda pending.',
        'npx vitest run',
      ),
    );
  } else if (scope === 'frontend') {
    steps.push(
      infraFrontend,
      frontendStep(2, { withApi: false, idea }),
      vitestStep(3),
      e2eBlog(4),
    );
  } else {
    steps.push(
      infraFrontend,
      backendStep(2, idea),
      frontendStep(3, { withApi: true, idea }),
      vitestStep(4, ' Incluir tests de la API Express (endpoints de posts y comments).'),
      e2eBlog(5),
    );
  }

  steps.forEach((s, i) => (s.id = i + 1));

  return {
    projectName,
    scope,
    appType: 'blog',
    validated: false,
    steps,
  };
}

export const blog = { name: 'blog', buildPlan };
