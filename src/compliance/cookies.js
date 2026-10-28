// Perfil de cumplimiento: cookies / trackers de terceros (ePrivacy).
// Se infiere cuando la idea menciona analytics/ads/marketing — o se
// fuerza con --compliance cookies.
export default {
  id: 'cookies',
  label: 'Cookies / trackers',
  infer: /(analytics|analitica|ads?|publicidad|marketing|pixel|tracking|metricas?|seo)/,
  overlayDir: 'cookies',
  promptBlock: `
- Como la app usa scripts de terceros que instalan cookies/trackers (analytics, ads, pixels, embebidos con tracking), integrar el componente \`src/components/CookieBanner.jsx\` (ya copiado al proyecto): renderizarlo una vez en App, gatear scripts/iframes de terceros con \`loadThirdParty()\`/\`useCookieConsent()\` (opt-in — nada de tracking antes de aceptar), y declarar el uso de cookies en /privacidad.`,
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
