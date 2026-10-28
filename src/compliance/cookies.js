// Perfil de cumplimiento: cookies / trackers de terceros (ePrivacy).
// Se infiere cuando la idea menciona analytics/ads/marketing — o se
// fuerza con --compliance cookies.
export default {
  id: 'cookies',
  label: 'Cookies / trackers',
  infer: /(analytics|analitica|ads?|publicidad|marketing|pixel|tracking|metricas?|seo)/,
  promptBlock: `
- Como la app usa scripts de terceros que instalan cookies/trackers (analytics, ads, pixels, embebidos con tracking), incluir un banner de consentimiento de cookies ANTES de cargarlos: bloquear los scripts hasta que el usuario acepte (opt-in), opción de rechazar (equivalente en prominencia), y persistir la elección (localStorage). Declarar el uso de cookies en /privacidad.`,
  requirements: [
    {
      check: 'some',
      type: 'frontend',
      keywords: ['cookies', 'banner'],
      error: 'algún paso frontend debe declarar el banner de consentimiento de cookies',
      prompt:
        'Algún paso `frontend` debe declarar el banner de consentimiento de cookies opt-in (bloquea scripts de terceros hasta aceptar).',
    },
  ],
};
