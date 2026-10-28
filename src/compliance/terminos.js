// Perfil de cumplimiento: términos y condiciones. Se infiere en apps
// transaccionales o con contenido de usuarios (tienda, pedidos, UGC) —
// o se fuerza con --compliance terminos.
export default {
  id: 'terminos',
  label: 'Términos y condiciones',
  infer: /(tienda|store|compra|venta|e-?commerce|pedido|order|suscrip|comentario|comment|comunidad|foro|ugc)/,
  promptBlock: `
- Crear la página/sección \`/terminos\` con términos y condiciones del servicio (template con placeholders: objeto del servicio, responsabilidades, limitación de garantías/responsabilidad, jurisdicción aplicable, contacto) y link visible en el footer junto a /privacidad.`,
  requirements: [
    {
      check: 'some',
      type: 'frontend',
      keywords: ['terminos'],
      error: 'algún paso frontend debe declarar la página de términos y condiciones',
      prompt:
        'Algún paso `frontend` debe declarar la página /terminos (términos y condiciones) con link en el footer.',
    },
  ],
};
