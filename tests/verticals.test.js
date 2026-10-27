import { describe, expect, it } from 'vitest';
import { buildPlan as landingPlan } from '../src/verticals/landing/index.js';
import { buildPlan as ordersPlan } from '../src/verticals/orders/index.js';

const descs = (plan) => plan.steps.map((s) => s.description).join('\n');

describe('landing — phone condiciona contacto/WhatsApp', () => {
  it('con phone: contacto + spec wa.me con el número real', () => {
    const d = descs(landingPlan({ projectName: 'x', idea: 'i', phone: '5491111111111' }));
    expect(d).toContain('Contacto con formulario');
    expect(d).toContain('WHATSAPP_NUMBER = \'5491111111111\'');
    expect(d).not.toContain('5491100000000'); // nunca placeholder
  });

  it('sin phone: ni contacto ni botón de WhatsApp ni wa.me', () => {
    const d = descs(landingPlan({ projectName: 'x', idea: 'i' }));
    expect(d).not.toContain('Contacto con formulario');
    expect(d).not.toContain('wa.me');
    expect(d).toContain('NO incluir botón flotante de WhatsApp');
  });
});

describe('orders — phone condiciona el botón de pedido', () => {
  it('con phone: botón wa.me con el número real', () => {
    const d = descs(ordersPlan({ projectName: 'x', idea: 'i', scope: 'frontend', phone: '5491111111111' }));
    expect(d).toContain('Enviar pedido por WhatsApp');
    expect(d).toContain('WHATSAPP_NUMBER = \'5491111111111\'');
    expect(d).not.toContain('5491100000000');
  });

  it('sin phone + sin api: confirmación local, sin wa.me', () => {
    const d = descs(ordersPlan({ projectName: 'x', idea: 'i', scope: 'frontend' }));
    expect(d).toContain('Confirmar pedido');
    expect(d).not.toContain('wa.me');
    expect(d).not.toContain('5491100000000');
  });

  it('sin phone + con api: el pedido persiste via POST /api/orders', () => {
    const d = descs(ordersPlan({ projectName: 'x', idea: 'i', scope: 'fullstack' }));
    expect(d).toContain('POST /api/orders');
    expect(d).not.toContain('wa.me');
  });
});
