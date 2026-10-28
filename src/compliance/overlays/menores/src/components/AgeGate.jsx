import { useState } from 'react';

// Verificación de edad (age gate) — para apps dirigidas o accesibles
// por menores (COPPA / GDPR art. 8 / Ley 25.326 AR).
// Bloquea el contenido hasta que el usuario declare su edad.
// - Si la app recolecta datos personales de menores, la política de
//   privacidad debe declarar el consentimiento parental verificable.
// Integración: envolver el contenido sensible:
//   <AgeGate minAge={18} fallback={<AvisoEdad />}>
//     <ContenidoRestringido />
//   </AgeGate>
// minAge opcional (default 18); fallback opcional = qué mostrar si es
// menor (default: aviso genérico + botón de salida).

const KEY = 'age-verified';

export const isAgeVerified = () =>
  typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'yes';

export default function AgeGate({ minAge = 18, fallback = null, children }) {
  const [verified, setVerified] = useState(isAgeVerified());
  const [underAge, setUnderAge] = useState(false);

  if (verified) return children;

  if (underAge) {
    return (
      fallback ?? (
        <div className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-lg font-medium text-neutral-800">
            Este contenido es solo para mayores de {minAge} años.
          </p>
          <a href="/" className="text-sm text-neutral-500 underline">
            Volver al inicio
          </a>
        </div>
      )
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Verificación de edad"
      className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-6 p-6 text-center"
    >
      <p className="text-lg font-medium text-neutral-800">
        ¿Tenés {minAge} años o más?
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(KEY, 'yes');
            setVerified(true);
          }}
          className="rounded-lg bg-neutral-900 px-6 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Sí
        </button>
        <button
          type="button"
          onClick={() => setUnderAge(true)}
          className="rounded-lg border border-neutral-300 px-6 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          No
        </button>
      </div>
      <p className="text-xs text-neutral-400">
        Al confirmar declarás ser mayor de edad. Los datos de menores
        requieren consentimiento parental — ver /privacidad.
      </p>
    </div>
  );
}
