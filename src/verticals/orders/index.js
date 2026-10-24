const step = (id, type, description, verify) => ({
  id,
  type,
  description,
  verify,
  status: 'pending',
  attempts: 0,
});

const infraFrontend = (skel) =>
  step(
    1,
    'infra',
    `El proyecto ya contiene el skeleton base (${skel}) instalado por el orquestador. Verificar que \`npm run build\` compila; si falta node_modules ejecutar \`npm install\` primero. NO reestructurar la config base.`,
    'npm run build',
  );

const e2eOrders = (n) =>
  step(
    n,
    'e2e',
    'Escribir specs Playwright en e2e/ (chromium; playwright.config.js ya configurado): la página carga sin errores de consola, el menú se ve, el carrito vacío muestra fallback informativo, el botón de pedido está deshabilitado hasta que el formulario es válido, y el link de pedido apunta a wa.me con el número configurado y el mensaje contiene items + total del carrito. Para aislar el e2e del backend, mockear las rutas /api/* con page.route (respuestas JSON fijas: business, categories, products). Instalar el browser con `npx playwright install chromium` si hace falta.',
    'npm run test:e2e',
  );

const vitestStep = (n, extra = '') =>
  step(
    n,
    'test',
    `Escribir tests con Vitest + Testing Library (jsdom ya configurado) cubriendo: menú renderiza items y fallback con lista vacía, botón de pedido deshabilitado por defecto y habilitado con datos válidos.${extra}`,
    'npx vitest run',
  );

function backendStep(n, idea) {
  return step(
    n,
    'backend',
    'El proyecto ya tiene el api-skeleton instalado: Express 5 + SQLite (better-sqlite3) en server/, auto-mount de server/routes/*.js en /api/*, static /uploads y POST /api/uploads (multer). El overlay del vertical ya proveyó server/schema.sql (business, categories, products, orders, order_items), server/seed-data.js y las routes business/categories/products/orders. ' +
      `Personalizar server/seed-data.js según la idea del usuario: "${idea}" — nombre/tagline/dirección/horarios/whatsapp del local en business, productos reales del rubro repartidos en las categorías (icon lucide en kebab-case). ` +
      'Agregar routes/endpoints extra SOLO si la idea los pide (un archivo nuevo en server/routes/ se monta solo en /api/<nombre>). NO tocar server/db.js, server/app.js ni la convención de auto-mount. ' +
      'Express y SQLite ya están configurados — no reinstalar ni reestructurar. Agregar tests Vitest en server/ cubriendo GET /api/business, /api/categories, /api/products, POST /api/orders y GET /api/orders/:id.',
    'npx vitest run',
  );
}

const whatsappCartSpec = (phone) =>
  ` Carrito de compras (agregar/quitar items con cantidades) + botón "Enviar pedido por WhatsApp" que abre https://wa.me/<numero>?text=<mensaje encodeURIComponent> — el mensaje arma una línea por item (nombre x cantidad — $precio), el total del carrito, y los datos del formulario de pedido (nombre, teléfono, notas). El número vive en una constante exportada (ej. src/data/config.js → WHATSAPP_NUMBER = '${phone || '5491100000000'}'). Si el número está vacío → NO renderizar el botón de WhatsApp. Botón disabled hasta que el carrito tenga items y el formulario sea válido.`;

function frontendStep(n, { withApi, idea, phone }) {
  return step(
    n,
    'frontend',
    `Implementar la web de pedidos en React + Tailwind sobre el skeleton. Idea del usuario: "${idea}". ${
      withApi
        ? 'Todo el contenido viene de la API: GET /api/business (nombre del local en navbar/hero/footer, horarios, dirección), GET /api/categories y GET /api/products (menú agrupable por categoría); además del envío por WhatsApp, el pedido puede persistirse via POST /api/orders. Fallback informativo si la API falla o devuelve vacío.'
        : 'El menú usa datos locales en src/data/products.js.'
    } ` +
      'Contenido no provisto → lorem ipsum / placeholders. Cumplir todas las reglas de UI de AGENTS.md: botón de pedido deshabilitado hasta tener items y datos válidos, fallback informativo si el menú viene vacío o la API falla, sin links con URL vacía.' +
      whatsappCartSpec(phone),
    'npm run build',
  );
}

/**
 * Página de pedidos para casas de comida.
 * scope: 'fullstack' | 'frontend' (mock) | 'backend' (solo API).
 */
export function buildPlan({ projectName, idea, scope = 'fullstack', phone, stacks }) {
  const skel = stacks?.frontend?.skeletonDesc ?? 'Vite + React + Tailwind + Vitest + Playwright';
  const steps = [];

  if (scope === 'backend') {
    steps.push(
      backendStep(1, idea),
      step(
        2,
        'test',
        'Ampliar tests Vitest de la API: GET /api/products devuelve productos, POST /api/orders valida campos y persiste, GET /api/orders/:id devuelve el pedido o 404.',
        'npx vitest run',
      ),
    );
  } else if (scope === 'frontend') {
    steps.push(
      infraFrontend(skel),
      frontendStep(2, { withApi: false, idea, phone }),
      vitestStep(3),
      e2eOrders(4),
    );
  } else {
    steps.push(
      infraFrontend(skel),
      backendStep(2, idea),
      frontendStep(3, { withApi: true, idea, phone }),
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
