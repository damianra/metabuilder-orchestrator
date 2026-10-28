// Perfil de cumplimiento: página 404 integrada. SIEMPRE activo con
// frontend — toda app necesita una ruta catch-all coherente con su
// línea visual, no el error crudo del servidor/browser.
export default {
  id: 'notfound',
  label: 'Página 404 integrada',
  promptBlock: `
- Crear una página 404 integrada (ruta catch-all \`*\` en React Router o \`not-found\` de Next): mensaje claro, ícono lucide, link/botón de vuelta al inicio, misma línea visual del sitio. Las rutas inexistentes nunca deben mostrar el error crudo del servidor.`,
  requirements: [
    {
      check: 'some',
      type: 'frontend',
      keywords: ['404'],
      error: 'algún paso frontend debe declarar la página 404 integrada (ruta catch-all)',
      prompt:
        'Algún paso `frontend` debe declarar la página 404 integrada (ruta catch-all `*` o `not-found`, con link de vuelta al inicio).',
    },
  ],
};
