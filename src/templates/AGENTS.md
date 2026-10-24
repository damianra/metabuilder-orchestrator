# Convenciones del proyecto

Este proyecto fue generado por MetaBuilder. Stack esperado:

- **Frontend**: {{frontendStack}} (si aplica)
- **Backend**: Node.js + Express (si aplica)
- **Base de datos**: SQLite (archivo local, sin servidores externos) (si aplica)
- **Testing**: Vitest (unit/integración), Playwright + Chromium (E2E, si hay frontend)

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

## Integración WhatsApp (wa.me link)

Patrón estándar cuando la app pide contacto/pedidos por WhatsApp:

- Link: `https://wa.me/<NUMERO>?text=<mensaje>` — número en formato internacional sin `+` ni espacios (ej. `5491155500000`), mensaje con `encodeURIComponent`.
- El número vive en una constante exportada (ej. `src/data/config.js` → `WHATSAPP_NUMBER`) — nunca hardcodeado dentro del componente.
- Si `WHATSAPP_NUMBER` está vacío → NO renderizar el botón ni el formulario de WhatsApp (regla 3: URL vacía).
- **Landing**: botón flotante fijo (abajo-derecha, ícono `MessageCircle` de lucide) que despliega un mini-formulario (nombre + mensaje); enviar abre el wa.me link con el mensaje armado.
- **Pedidos/carrito**: el mensaje arma una línea por item (`nombre x cantidad — $precio`), el total, y los datos del cliente (nombre, teléfono, notas).

## Scripts de package.json que deben existir

- `npm run build` — build de producción (si hay frontend)
- `npm test` / `npx vitest run` — suite Vitest
- `npm run test:e2e` — suite Playwright (si hay frontend)
- `npm run api` — API Express en puerto 4000 (si hay backend)
- `npm run dev:api` — lo mismo con `--watch` (si hay backend)

## Notas para el agente que escribe código

- Mantener los pasos atómicos y autocontenidos: cada tarea debe dejar el proyecto en un estado compilable.
- No commitear `node_modules/`, `.env`, `*.sqlite`, `server/uploads/*`, `dist/`, `out/` ni `build/`.
- Al escribir tests E2E con Playwright, cubrir explícitamente las reglas de UI de arriba.
- **Backend (api-skeleton)**: cada `server/routes/<name>.js` que exporte un `Router` default se monta solo en `/api/<name>` — no tocar `server/app.js` ni `server/db.js`. Schema en `server/schema.sql` (idempotente), seed en `server/seed-data.js` (se inserta si la tabla está vacía).
- **Imágenes**: `POST /api/uploads` con campo `file` (image/*, máx 5MB) → `{ url: "/uploads/<file>" }`. Guardar ese path en la entidad (ej. `cover_image`); el frontend lo consume tal cual (el proxy de Vite redirige `/uploads` al puerto 4000).
- **Secretos/config**: API keys y config sensible van en `.env` (gitignored), leídas via `process.env.NOMBRE` — `server/index.js` ya carga `dotenv/config`. Toda variable que la app use debe declararse en `.env.example` (commiteado, con valor placeholder o vacío) para que otro dev sepa qué configurar. Nunca hardcodear secretos ni commitear `.env`.
- **Docker**: `Dockerfile`, `.dockerignore` (y `nginx.conf` si aplica) los provee el orquestador — no modificarlos ni crear otros. El backend ya sirve `dist/` si existe, así que el contenedor fullstack corre solo `node server/index.js`.
