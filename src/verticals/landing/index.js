const step = (id, type, description, verify) => ({
  id,
  type,
  description,
  verify,
  status: 'pending',
  attempts: 0,
});

const whatsappSpec = (phone) => ` Integración WhatsApp por wa.me link: un botón flotante fijo (abajo a la derecha, ícono lucide MessageCircle) que despliega un mini-formulario (nombre + mensaje); al enviar abre https://wa.me/<numero>?text=<mensaje con encodeURIComponent>. El número vive en una constante exportada (ej. src/data/config.js → WHATSAPP_NUMBER = '${phone || '5491100000000'}'). Si ese valor queda vacío, NO renderizar el botón ni el formulario (regla de URL vacía). El botón de enviar del mini-formulario debe estar disabled hasta que haya mensaje válido.`;

/**
 * Landing informativa de una página (frontend-only).
 * El skeleton Vite+React+Tailwind ya está copiado por preflight.
 */
export function buildPlan({ projectName, idea, phone }) {
  return {
    projectName,
    scope: 'frontend',
    appType: 'landing',
    validated: false,
    steps: [
      step(
        1,
        'infra',
        'El proyecto ya contiene el skeleton base (Vite + React + Tailwind + Vitest + Playwright) instalado por el orquestador. Verificar que `npm run build` compila. NO reestructurar el proyecto ni tocar la config base; si falta node_modules ejecutar `npm install` primero.',
        'npm run build',
      ),
      step(
        2,
        'frontend',
        `Implementar la landing en React + Tailwind sobre el skeleton existente. Idea del usuario: "${idea}". ` +
          'Secciones mínimas en una sola página: Hero (titular + CTA), Features/Servicios, Menú o Productos si aplica, Contacto con formulario (nombre, email, mensaje), Footer. ' +
          'Todo contenido que el usuario no haya provisto explícitamente → texto lorem ipsum breve y placeholders visuales (bloques de color o placehold.co). ' +
          'Cumplir TODAS las reglas de UI de AGENTS.md: botón de enviar deshabilitado por defecto y habilitado solo con campos válidos, no renderizar links/iconos con URL vacía, fallback informativo si no hay datos, componentes sin props inventadas, componentes no soportados con fallback silencioso. ' +
          'Aplicar la guía de diseño de AGENTS.md: íconos reales de lucide-react (nunca placeholders de color), paleta neutra + 1 acento, navbar con anclas, hero con gradiente, cards con ring/shadow/hover.' +
          whatsappSpec(phone),
        'npm run build',
      ),
      step(
        3,
        'test',
        'Escribir tests con Vitest + Testing Library (jsdom ya configurado en vite.config.js) en src/__tests__/: las secciones principales renderizan, la lista del menú muestra fallback cuando los datos están vacíos, el botón de enviar del formulario está deshabilitado por defecto y se habilita solo con campos válidos.',
        'npx vitest run',
      ),
      step(
        4,
        'e2e',
        'Escribir specs Playwright en e2e/ (chromium; playwright.config.js ya tiene webServer sobre vite dev): la página carga sin errores de consola, hero/menú/contacto son visibles, el botón de enviar está deshabilitado hasta que el formulario tiene datos válidos, el botón flotante de WhatsApp despliega el mini-formulario y su envío genera un link wa.me con el número configurado, y no existe ningún <a> con href vacío ni icono sin destino. Instalar el browser con `npx playwright install chromium` si hace falta.',
        'npm run test:e2e',
      ),
    ],
  };
}

export const landing = { name: 'landing', buildPlan };
