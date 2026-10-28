// Perfil de cumplimiento: pagos online. Se infiere cuando la idea
// menciona cobro/checkout/procesador — o se fuerza con
// --compliance pagos.
export default {
  id: 'pagos',
  label: 'Pagos online',
  infer: /(pago|pagos|checkout|cobro|cobrar|tarjeta|mercado\s?pago|stripe|paypal|suscrip)/,
  promptBlock: `
- Pagos: NUNCA capturar ni persistir datos de tarjeta en la app (PCI) — el cobro se delega a un procesador externo (redirect/checkout del provider o su SDK hosted). Precios y totales se calculan server-side (nunca confiar en el monto del cliente). Webhooks del procesador se validan server-side con firma/secreto desde .env (nunca expuesto al frontend).`,
  requirements: [
    {
      check: 'some',
      type: null,
      keywords: ['pago'],
      error: 'algún paso debe declarar el flujo de pago delegado a procesador externo',
      prompt:
        'Declarar el flujo de pago delegado a procesador externo (sin datos de tarjeta en la app, totales server-side, webhooks con firma desde .env).',
    },
  ],
};
