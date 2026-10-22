# Convenciones del proyecto

Este proyecto fue generado por MetaBuilder. Stack esperado:

- **Frontend**: React + Vite + Tailwind CSS (si aplica)
- **Backend**: Node.js + Express (si aplica)
- **Base de datos**: SQLite (archivo local, sin servidores externos) (si aplica)
- **Testing**: Vitest (unit/integración), Playwright + Chromium (E2E, si hay frontend)

## Reglas de UI obligatorias (React + Tailwind)

1. No agregar propiedades a componentes no utilizados; confiar solo en los datos disponibles del backend.
2. Los componentes no soportados no deben renderizar y no deben romper el flujo de la aplicación (fallback silencioso o controlado).
3. Si una URL está vacía, no se debe mostrar ningún icono ni intentar abrirse ninguna ventana.
4. Los botones de acción (ej. "Guardar", "Enviar") deben estar deshabilitados (`disabled`) por defecto y solo habilitarse cuando se detecten cambios reales en los campos del formulario.
5. Si una consulta a la API no devuelve resultados, la UI debe mostrar un estado de fallback informativo (nunca una pantalla en blanco o un error crudo).

## Scripts de package.json que deben existir

- `npm run build` — build de producción (si hay frontend)
- `npm test` / `npx vitest run` — suite Vitest
- `npm run test:e2e` — suite Playwright (si hay frontend)

## Notas para el agente que escribe código

- Mantener los pasos atómicos y autocontenidos: cada tarea debe dejar el proyecto en un estado compilable.
- No commitear `node_modules/`, `.env`, `*.sqlite`, `dist/` ni `build/`.
- Al escribir tests E2E con Playwright, cubrir explícitamente las reglas de UI de arriba.
