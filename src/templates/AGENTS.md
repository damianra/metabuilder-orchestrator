# Convenciones del proyecto

Este proyecto fue generado por MetaBuilder. Stack esperado:

- **Frontend**: {{frontendStack}} (si aplica)
- **Backend**: {{backendFramework}} (si aplica)
- **Base de datos**: {{backendDb}} (si aplica)
- **Testing**: {{testing}} (unit/integración), Playwright + Chromium (E2E, si hay frontend)

## Reglas de UI obligatorias (React + Tailwind)

1. No agregar propiedades a componentes no utilizados; confiar solo en los datos disponibles del backend.
2. Los componentes no soportados no deben renderizar y no deben romper el flujo de la aplicación (fallback silencioso o controlado).
3. Si una URL está vacía, no se debe mostrar ningún icono ni intentar abrirse ninguna ventana.
4. Los botones de acción (ej. "Guardar", "Enviar") deben estar deshabilitados (`disabled`) por defecto y solo habilitarse cuando se detecten cambios reales en los campos del formulario.
5. Si una consulta a la API no devuelve resultados, la UI debe mostrar un estado de fallback informativo (nunca una pantalla en blanco o un error crudo).

## Guía de diseño (obligatoria — el resultado debe verse moderno y limpio)

- **Íconos**: usar `lucide-react` (ya instalado). NUNCA cuadrados/círculos de color como placeholder de ícono — si un dato no tiene ícono propio, usar uno genérico (`Sparkles`) o nada. La data puede llevar un campo `icon` con nombre en kebab-case mapeado a componentes.
- **Paleta**: neutra (slate/stone/zinc) + 1 color de acento — máximo 2 colores de marca en toda la página.
- **Tipografía**: system-ui/Inter; headings `font-bold tracking-tight` (`text-3xl`–`text-5xl`), body `text-sm/base`, contraste alto.
- **Layout**: contenedores `max-w-6xl mx-auto px-6`; secciones `py-16` o `py-24`; grids `gap-6`/`gap-8`.
- **Cards**: `rounded-2xl bg-white ring-1 ring-<neutro>-200 shadow-sm hover:shadow-md transition`.
- **Botones**: `rounded-full` o `rounded-lg`, `px-6 py-3 font-semibold`; primario sólido + `hover:` visible; secundario outline.
- **Hero**: gradiente sutil (`bg-gradient-to-b`) o fondo sólido oscuro + badge/logo con ícono Lucide real; nunca un div vacío de color.
- **Navbar** simple con nombre/logo + links de ancla a las secciones.
- Contenido no provisto por el usuario → lorem ipsum breve; imágenes → placeholder (placehold.co) o bloque con ícono Lucide.

## Reglas de privacidad y seguridad (obligatorias)

- Todo formulario que capture datos personales exige un checkbox **no pre-tildado** "Acepto la política de privacidad" (link a `/privacidad`) — el botón de enviar solo se habilita marcado.
- Debe existir una página/sección `/privacidad` con aviso de datos (qué se recolecta, finalidad, retención, derechos ARCO, contacto del responsable) y link visible en el footer.
- Prohibido scripts de terceros con cookies/trackers (analytics, pixels, embebidos con tracking) sin banner de consentimiento previo.
- Nunca `dangerouslySetInnerHTML` con datos de usuario o de la API.
- SQL siempre con prepared statements — nunca interpolar valores en queries.
- Secretos solo en `.env` (gitignored); declarar en `.env.example`. Nunca en logs ni en el bundle del frontend.

## Integración WhatsApp (wa.me link)

Patrón estándar cuando la app pide contacto/pedidos por WhatsApp:

- Link: `https://wa.me/<NUMERO>?text=<mensaje>` — número en formato internacional sin `+` ni espacios (ej. `5491155500000`), mensaje con `encodeURIComponent`.
- El número vive en una constante exportada (ej. `src/data/config.js` → `WHATSAPP_NUMBER`) — nunca hardcodeado dentro del componente.
- Si `WHATSAPP_NUMBER` está vacío → NO renderizar el botón ni el formulario de WhatsApp (regla 3: URL vacía).
- **Landing**: botón flotante fijo (abajo-derecha, ícono `MessageCircle` de lucide) que despliega un mini-formulario (nombre + mensaje); enviar abre el wa.me link con el mensaje armado.
- **Pedidos/carrito**: el mensaje arma una línea por item (`nombre x cantidad — $precio`), el total, y los datos del cliente (nombre, teléfono, notas).

## Comandos que deben existir

{{devScripts}}

## Notas para el agente que escribe código

- Mantener los pasos atómicos y autocontenidos: cada tarea debe dejar el proyecto en un estado compilable.
- **Estado (front)**: `lib/api.js` como cliente único del backend (fetch + error handling centralizado); `useState` local por componente, `useReducer` para flujos multi-paso (formularios/wizard/cart). Sin librería de estado (Redux/Zustand/MobX) — fuera del scope: rápido, funcional, fácil de conectar front↔back.
- No commitear `node_modules/`, `.env`, `*.sqlite`, `server/uploads/*`, `dist/`, `out/` ni `build/`.
- Al escribir tests E2E con Playwright, cubrir explícitamente las reglas de UI de arriba.
{{backendNotes}}
