## Integración WhatsApp (wa.me link)

Patrón estándar cuando la app pide contacto/pedidos por WhatsApp:

- Link: `https://wa.me/<NUMERO>?text=<mensaje>` — número en formato internacional sin `+` ni espacios (ej. `5491155500000`), mensaje con `encodeURIComponent`.
- El número vive en una constante exportada (ej. `src/data/config.js` → `WHATSAPP_NUMBER`) — nunca hardcodeado dentro del componente.
- Si `WHATSAPP_NUMBER` está vacío → NO renderizar el botón ni el formulario de WhatsApp (regla 3: URL vacía).
- **Landing**: botón flotante fijo (abajo-derecha, ícono `MessageCircle` de lucide) que despliega un mini-formulario (nombre + mensaje); enviar abre el wa.me link con el mensaje armado.
- **Pedidos/carrito**: el mensaje arma una línea por item (`nombre x cantidad — $precio`), el total, y los datos del cliente (nombre, teléfono, notas).

