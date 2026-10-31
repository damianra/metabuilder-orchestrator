# Convenciones del proyecto

Este proyecto fue generado por MetaBuilder. Stack esperado:

- **Frontend**: {{frontendStack}} (si aplica)
- **Backend**: {{backendFramework}} (si aplica)
- **Base de datos**: {{backendDb}} (si aplica)
- **Testing**: {{testing}} (unit/integración), Playwright + Chromium (E2E, si hay frontend)

{{uiSections}}
## Reglas de privacidad y seguridad (obligatorias)

- Todo formulario que capture datos personales exige un checkbox **no pre-tildado** "Acepto la política de privacidad" (link a `/privacidad`) — el botón de enviar solo se habilita marcado.
- Debe existir una página/sección `/privacidad` con aviso de datos (qué se recolecta, finalidad, retención, derechos ARCO, contacto del responsable) y link visible en el footer.
- Prohibido scripts de terceros con cookies/trackers (analytics, pixels, embebidos con tracking) sin banner de consentimiento previo.
- Nunca `dangerouslySetInnerHTML` con datos de usuario o de la API.
- SQL siempre con prepared statements — nunca interpolar valores en queries.
- Secretos solo en `.env` (gitignored); declarar en `.env.example`. Nunca en logs ni en el bundle del frontend.

{{whatsappSection}}
## Comandos que deben existir

{{devScripts}}

## Notas para el agente que escribe código

- Mantener los pasos atómicos y autocontenidos: cada tarea debe dejar el proyecto en un estado compilable.
- **Estado (front)**: `lib/api.js` como cliente único del backend (fetch + error handling centralizado); `useState` local por componente, `useReducer` para flujos multi-paso (formularios/wizard/cart). Sin librería de estado (Redux/Zustand/MobX) — fuera del scope: rápido, funcional, fácil de conectar front↔back.
- Si la app tiene login/usuarios del seed, documentarlos en el README (sección 'Usuarios demo' con email+password dev y el rol de cada uno).
- No commitear `node_modules/`, `.env`, `*.sqlite`, `server/uploads/*`, `dist/`, `out/` ni `build/`.
- Al escribir tests E2E con Playwright, cubrir explícitamente las reglas de UI de arriba.
{{backendNotes}}
