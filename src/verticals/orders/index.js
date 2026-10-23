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

function backendStep(n) {
  return step(
    n,
    'backend',
    'Crear API con Express en server/ (script "api": "node server/index.js", puerto 4000) con SQLite vía better-sqlite3 (instalarlo; si la compilación nativa falla, usar node:sqlite de Node). ' +
      'Tablas con seed si están vacías: `business` (nombre del local, tagline, dirección, horarios, whatsapp), `categories` (nombre, orden) y `products` (nombre, descripción, precio, category_id, icon en kebab-case para lucide). ' +
      'Endpoints: GET /api/business (datos del local), GET /api/categories, GET /api/products (incluye categoría; ~8 productos de muestra repartidos en las categorías), POST /api/orders (valida customer/phone/items y persiste), GET /api/orders/:id. ' +
      'Configurar proxy /api → localhost:4000 en vite.config.js. Agregar tests de API con Vitest.',
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
export function buildPlan({ projectName, idea, scope = 'fullstack', phone }) {
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
      frontendStep(2, { withApi: false, idea, phone }),
      vitestStep(3),
      e2eOrders(4),
    );
  } else {
    steps.push(
      infraFrontend,
      backendStep(2),
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
