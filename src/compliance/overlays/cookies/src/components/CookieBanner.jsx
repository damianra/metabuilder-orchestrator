import { useCallback, useEffect, useState } from 'react';

// Banner de consentimiento de cookies (opt-in, ePrivacy/GDPR).
// - Bloquea scripts de terceros hasta que el usuario acepta.
// - Rechazar tiene la misma prominencia que aceptar (equidad GDPR).
// - La elección persiste en localStorage y es revocable.
// Integración:
//   1. <CookieBanner /> una vez en App (sobre todo el contenido).
//   2. Scripts de terceros → loadThirdParty(src) en vez de <script>
//      en index.html — solo se inyectan tras consentimiento.
//   3. Re-consentimiento: un link "cookies" puede llamar resetConsent().

const KEY = 'cookie-consent'; // 'accepted' | 'rejected'

export const getConsent = () =>
  typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);

export const resetConsent = () => {
  localStorage.removeItem(KEY);
  window.location.reload();
};

// Hook: true solo si el usuario aceptó — para gatear <iframe>/SDKs.
export function useCookieConsent() {
  const [consent, setConsent] = useState(getConsent() === 'accepted');
  useEffect(() => {
    const onChange = () => setConsent(getConsent() === 'accepted');
    window.addEventListener('cookie-consent', onChange);
    return () => window.removeEventListener('cookie-consent', onChange);
  }, []);
  return consent;
}

// Inyecta un <script> solo si hay consentimiento (re-check al llamar).
export function loadThirdParty(src, attrs = {}) {
  if (getConsent() !== 'accepted') return false;
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
  document.head.appendChild(s);
  return true;
}

export default function CookieBanner({ policyUrl = '/privacidad' }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getConsent() === null);
  }, []);

  const choose = useCallback((value) => {
    localStorage.setItem(KEY, value);
    setVisible(false);
    window.dispatchEvent(new Event('cookie-consent'));
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Consentimiento de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <p className="flex-1 text-sm text-neutral-700">
          Usamos cookies propias y de terceros para analítica y mejorar tu
          experiencia. Podés aceptarlas o rechazarlas — la elección se puede
          cambiar después desde el pie de página. Más info en la{' '}
          <a className="underline" href={policyUrl}>
            política de privacidad
          </a>
          .
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => choose('rejected')}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => choose('accepted')}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
