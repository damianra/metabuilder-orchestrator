import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api.js';
import DesignTab from '../DesignTab.jsx';

// api.js mockeado: el tab toca designStatus/createDesign/discardDesign/
// designDev/designStopDev/designSave/designChat. `state` es mutable —
// designStatus lo lee en cada poll, así un test puede simular que el
// workspace apareció o que vite ya imprimió su URL.
const state = { design: { exists: false, messages: [] } };

// jsdom no implementa scrollIntoView (auto-scroll del chat).
Element.prototype.scrollIntoView = vi.fn();

vi.mock('../../api.js', () => ({
  api: {
    designStatus: vi.fn(() => Promise.resolve(state.design)),
    createDesign: vi.fn(() => Promise.resolve({ ok: true })),
    discardDesign: vi.fn(() => Promise.resolve({ ok: true })),
    designDev: vi.fn(() => Promise.resolve({ ok: true, status: 'running' })),
    designStopDev: vi.fn(() => Promise.resolve({ stopped: true })),
    designSave: vi.fn((slug) => Promise.resolve({ ok: true, slug })),
    designChat: vi.fn(() => Promise.resolve({ ok: true, text: 'listo, quedó el hero' })),
  },
}));

const renderTab = async (props = {}) => {
  const utils = render(<DesignTab {...props} />);
  await act(async () => {}); // flush del primer designStatus
  return utils;
};

describe('DesignTab', () => {
  it('sin workspace muestra el empty state y crear llama api.createDesign', async () => {
    state.design = { exists: false, messages: [] };
    await renderTab();
    expect(screen.getByText('Diseñar app')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Nuevo diseño'));
    });
    expect(api.createDesign).toHaveBeenCalledTimes(1);
  });

  it('con workspace renderiza el historial del chat', async () => {
    state.design = {
      exists: true,
      messages: [
        { role: 'user', text: 'una landing dark' },
        { role: 'agent', text: 'listo, hero con gradiente' },
      ],
    };
    await renderTab();
    expect(screen.getByText('una landing dark')).toBeTruthy();
    expect(screen.getByText('listo, hero con gradiente')).toBeTruthy();
  });

  it('enviar un mensaje llama api.designChat y muestra el reply en vivo', async () => {
    state.design = { exists: true, messages: [] };
    api.designChat.mockImplementationOnce((text, { onChunk }) => {
      onChunk('cambiando el hero…');
      return Promise.resolve({ ok: true, text: 'cambiando el hero…' });
    });
    await renderTab();
    const input = screen.getByPlaceholderText('Pedile un cambio al diseñador…');
    fireEvent.change(input, { target: { value: 'hero más grande' } });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Enviar'));
    });
    expect(api.designChat).toHaveBeenCalledWith(
      'hero más grande',
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
  });

  it('preview llama api.designDev; sin url todavía no hay iframe', async () => {
    state.design = { exists: true, messages: [] };
    const { container } = await renderTab();
    expect(container.querySelector('iframe')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTitle(/vite dev server/));
    });
    expect(api.designDev).toHaveBeenCalledTimes(1);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('con url en el status renderiza el iframe de preview', async () => {
    state.design = { exists: true, messages: [], urls: ['http://localhost:5173'] };
    const { container } = await renderTab();
    expect(container.querySelector('iframe')?.src).toBe('http://localhost:5173/');
  });

  it('guardar llama api.designSave con el slug y avisa onSaved', async () => {
    state.design = { exists: true, messages: [] };
    const onSaved = vi.fn();
    await renderTab({ onSaved });
    fireEvent.change(screen.getByPlaceholderText('nombre-app'), {
      target: { value: 'mi-app' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('guardar como app'));
    });
    expect(api.designSave).toHaveBeenCalledWith('mi-app');
    expect(onSaved).toHaveBeenCalledWith('mi-app');
  });

  it('descartar pide confirmación y recién ahí llama api.discardDesign', async () => {
    state.design = { exists: true, messages: [] };
    api.discardDesign.mockClear();
    await renderTab();
    await act(async () => {
      fireEvent.click(screen.getByText('descartar'));
    });
    expect(api.discardDesign).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText('¿seguro?'));
    });
    expect(api.discardDesign).toHaveBeenCalledTimes(1);
  });
});
