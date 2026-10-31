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
    projects: vi.fn(() => Promise.resolve([{ slug: 'mi-api', scope: 'backend' }])),
    action: vi.fn(() => Promise.resolve({ ok: true })),
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
    let resolveChat;
    api.designChat.mockImplementationOnce((text, { onChunk }) => {
      onChunk('cambiando el hero…');
      return new Promise((r) => {
        resolveChat = r;
      });
    });
    await renderTab();
    const input = screen.getByPlaceholderText('Pedile un cambio al diseñador…');
    fireEvent.change(input, { target: { value: 'hero más grande' } });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Enviar'));
    });
    // el chunk streameado ya se ve en el bubble en curso
    expect(screen.getByText('cambiando el hero…')).toBeTruthy();
    await act(async () => {
      resolveChat({ ok: true, text: 'cambiando el hero…' });
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

  it('una proposal del agente se renderiza como card con botones', async () => {
    state.design = {
      exists: true,
      messages: [
        {
          role: 'agent',
          text: 'Listo, quedó el diseño.\n\n```proposal\n{"question":"¿cómo seguimos?","options":[{"label":"Guardar como app","action":"save"},{"label":"Seguir iterando","reply":"quiero seguir ajustando"}]}\n```',
        },
      ],
    };
    await renderTab();
    // el bloque no se muestra como texto — va la card
    expect(screen.getByText('¿cómo seguimos?')).toBeTruthy();
    expect(screen.getByText('Listo, quedó el diseño.')).toBeTruthy();
    expect(screen.queryByText(/```proposal/)).toBeNull();
    expect(screen.getByText('Guardar como app')).toBeTruthy();
  });

  it('opción con reply → se envía como mensaje al chat', async () => {
    state.design = {
      exists: true,
      messages: [
        {
          role: 'agent',
          text: '```proposal\n{"question":"¿ok?","options":[{"label":"Sí, seguí","reply":"dale, seguí con el footer"}]}\n```',
        },
      ],
    };
    api.designChat.mockClear();
    await renderTab();
    await act(async () => {
      fireEvent.click(screen.getByText('Sí, seguí'));
    });
    expect(api.designChat).toHaveBeenCalledWith(
      'dale, seguí con el footer',
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
  });

  it('opción con action desconocida → fallback reply con el label', async () => {
    state.design = {
      exists: true,
      messages: [
        {
          role: 'agent',
          text: '```proposal\n{"question":"¿ok?","options":[{"label":"Hacé la magia","action":"teleport"}]}\n```',
        },
      ],
    };
    api.designChat.mockClear();
    await renderTab();
    await act(async () => {
      fireEvent.click(screen.getByText('Hacé la magia'));
    });
    expect(api.designChat).toHaveBeenCalledWith(
      'Hacé la magia',
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
  });

  it('backend attachado: chip + botón api off dispara run-dev sobre ese slug', async () => {
    state.design = {
      exists: true,
      messages: [],
      attachTo: 'mi-api',
      backend: { slug: 'mi-api', apiRunning: false },
    };
    api.action.mockClear();
    await renderTab();
    expect(screen.getByText(/para backend: mi-api/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('api off'));
    });
    expect(api.action).toHaveBeenCalledWith('mi-api', { action: 'run-dev' });
  });

  it('attachSlug (#/design?attach=) preselecciona el backend del attach', async () => {
    state.design = { exists: false, messages: [] };
    api.createDesign.mockClear();
    await renderTab({ attachSlug: 'mi-api' });
    await act(async () => {});
    const sel = screen.getByTestId('design-backend-for');
    expect(sel.value).toBe('mi-api');
    await act(async () => {
      fireEvent.click(screen.getByText('Nuevo diseño'));
    });
    expect(api.createDesign).toHaveBeenCalledWith('mi-api', 'vite-react');
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
