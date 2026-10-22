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

const e2eOrders = (n) =>
  step(
    n,
    'e2e',
    'Escribir specs Playwright en e2e/ (chromium; playwright.config.js ya configurado): la página carga sin errores de consola, el menú se ve, el botón de pedido está deshabilitado hasta que el formulario es válido, y el carrito vacío muestra fallback informativo. Para aislar el e2e del backend, mockear /api con page.route (respuestas JSON fijas). Instalar el browser con `npx playwright install chromium` si hace falta.',
    'npm run test:e2e',
  );

const vitestStep = (n, extra = '') =>
  step(
    n,
    'test',
    `Escribir tests con Vitest + Testing Library (jsdom ya configurado) cubriendo: menú renderiza items y fallback con lista vacía, botón de pedido deshabilitado por defecto y habilitado con datos válidos.${extra}`,
    'npx vitest run',
  );

function backendStep(n) {
  return step(
    n,
    'backend',
    'Crear API con Express en server/ (script "api": "node server/index.js", puerto 4000) con SQLite vía better-sqlite3 (instalarlo; si la compilación nativa falla, usar node:sqlite de Node). ' +
      'Endpoints: GET /api/products (menú con seed de ~8 productos de muestra si la tabla está vacía), POST /api/orders (valida customer/phone/items y persiste), GET /api/orders/:id. ' +
      'Configurar proxy /api → localhost:4000 en vite.config.js. Agregar tests de API con Vitest.',
    'npx vitest run',
  );
}

function frontendStep(n, { withApi, idea }) {
  return step(
    n,
    'frontend',
    `Implementar la web de pedidos en React + Tailwind sobre el skeleton. Idea del usuario: "${idea}". ${
      withApi
        ? 'El menú se obtiene de GET /api/products; el formulario de pedido (nombre, teléfono, items, notas) hace POST /api/orders y muestra confirmación con el id devuelto.'
        : 'El menú usa datos locales en src/data/products.js; el formulario de pedido simula el envío mostrando una confirmación (sin backend real).'
    } ` +
      'Contenido no provisto → lorem ipsum / placeholders. Cumplir todas las reglas de UI de AGENTS.md: botón de pedido deshabilitado hasta tener items y datos válidos, fallback informativo si el menú viene vacío o la API falla, sin links con URL vacía.',
    'npm run build',
  );
}

/**
 * Página de pedidos para casas de comida.
 * scope: 'fullstack' | 'frontend' (mock) | 'backend' (solo API).
 */
export function buildPlan({ projectName, idea, scope = 'fullstack' }) {
  const steps = [];

  if (scope === 'backend') {
    steps.push(
      step(
        1,
        'infra',
        'Inicializar proyecto Node ESM mínimo: package.json con "type": "module", scripts "api" y "test" (vitest), e instalar express + better-sqlite3 + vitest.',
        'npm run test -- --passWithNoTests',
      ),
      backendStep(2),
      step(
        3,
        'test',
        'Ampliar tests Vitest de la API: GET /api/products devuelve productos, POST /api/orders valida campos y persiste, GET /api/orders/:id devuelve el pedido o 404.',
        'npx vitest run',
      ),
    );
  } else if (scope === 'frontend') {
    steps.push(
      infraFrontend,
      frontendStep(2, { withApi: false, idea }),
      vitestStep(3),
      e2eOrders(4),
    );
  } else {
    steps.push(
      infraFrontend,
      backendStep(2),
      frontendStep(3, { withApi: true, idea }),
      vitestStep(4, ' Incluir tests de la API Express (endpoints de products y orders).'),
      e2eOrders(5),
    );
  }

  // Renumerar ids de forma consistente
  steps.forEach((s, i) => (s.id = i + 1));

  return {
    projectName,
    scope,
    appType: 'orders',
    validated: false,
    steps,
  };
}

export const orders = { name: 'orders', buildPlan };
