// Perfil de cumplimiento: privacidad / protección de datos personales.
// SIEMPRE activo cuando el scope tiene frontend — las apps generadas
// recolectan datos (formularios, pedidos, comentarios) aunque el
// usuario no lo pida explícitamente.
export default {
  id: 'privacidad',
  label: 'Privacidad / datos personales',
  promptBlock: `
Cumplimiento legal OBLIGATORIO en esta app:
- Crear la página/sección \`/privacidad\` con aviso de protección de datos personales: qué datos se recolectan (los que capturan los formularios), finalidad, base legal (consentimiento), tiempo de retención, derechos del titular (acceso, rectificación, supresión — ARCO) y un email de contacto del responsable (placeholder editable). Si el contacto va por WhatsApp → declarar que los datos viajan a Meta (terceros).
- Footer con link visible a /privacidad en todas las páginas.
- Todo formulario que capture datos personales (nombre, teléfono, email, dirección, comentarios) exige un checkbox NO pre-tildado: "Acepto la política de privacidad" con link a /privacidad — el botón de enviar solo se habilita si está marcado.
- Prohibido agregar scripts de terceros que instalen cookies/trackers (analytics, embebidos con tracking, pixel) sin un banner de consentimiento previo. Si ninguno se usa → no crear banner.
- Nunca renderizar datos de usuario o de la API con dangerouslySetInnerHTML.`,
  requirements: [
    {
      check: 'some',
      type: 'frontend',
      keywords: ['privacidad', 'consentimiento'],
      error:
        'algún paso frontend debe declarar la página de privacidad y el consentimiento en formularios con datos personales',
      prompt:
        'Algún paso `frontend` debe declarar la página de privacidad y el checkbox de consentimiento en formularios con datos personales (reglas de privacidad del `AGENTS.md`).',
    },
  ],
};
