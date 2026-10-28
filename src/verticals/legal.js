// Bloque legal compartido: se appenda a los pasos `frontend` de los
// verticales. Cumplimiento mínimo para apps que recolectan datos
// personales (GDPR / ePrivacy / Ley 25.326 AR / CCPA):
// - página de privacidad + link en el footer,
// - consentimiento explícito en formularios que capturan datos,
// - prohibición de trackers/cookies de terceros sin banner previo.
export const legalBlock = `
Cumplimiento legal OBLIGATORIO en esta app:
- Crear la página/sección \`/privacidad\` con aviso de protección de datos personales: qué datos se recolectan (los que capturan los formularios), finalidad, base legal (consentimiento), tiempo de retención, derechos del titular (acceso, rectificación, supresión — ARCO) y un email de contacto del responsable (placeholder editable). Si el contacto va por WhatsApp → declarar que los datos viajan a Meta (terceros).
- Footer con link visible a /privacidad en todas las páginas.
- Todo formulario que capture datos personales (nombre, teléfono, email, dirección, comentarios) exige un checkbox NO pre-tildado: "Acepto la política de privacidad" con link a /privacidad — el botón de enviar solo se habilita si está marcado.
- Prohibido agregar scripts de terceros que instalen cookies/trackers (analytics, embebidos con tracking, pixel) sin un banner de consentimiento previo. Si ninguno se usa → no crear banner.
- Nunca renderizar datos de usuario o de la API con dangerouslySetInnerHTML.`;
