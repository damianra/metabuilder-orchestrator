import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api.js';
import MobileTab from '../MobileTab.jsx';

// api.js mockeado: el tab toca mobileStatus/createMobile/discardMobile/
// mobileDev/mobileStopDev/mobileSave/mobileChat. `state` es mutable —
// mobileStatus lo lee en cada poll, así un test puede simular que el
// workspace apareció o que Expo ya imprimió su URL (:8081).
const state = { mobile: { exists: false, messages: [] } };

// jsdom no implementa scrollIntoView (auto-scroll del chat).
Element.prototype.scrollIntoView = vi.fn();

vi.mock('../../api.js', () => ({
  api: {
    mobileStatus: vi.fn(() => Promise.resolve(state.mobile)),
    createMobile: vi.fn(() => Promise.resolve({ ok: true })),
    discardMobile: vi.fn(() => Promise.resolve({ ok: true })),
    mobileDev: vi.fn(() => Promise.resolve({ ok: true, status: 'running' })),
    mobileStopDev: vi.fn(() => Promise.resolve({ stopped: true })),
    mobileSave: vi.fn((slug) => Promise.resolve({ ok: true, slug })),
    mobileChat: vi.fn(() => Promise.resolve({ ok: true, text: 'listo, pantalla nueva' })),
    archiveMobile: vi.fn(() => Promise.resolve({ ok: true, slug: 'mi-diseno' })),
    // Biblioteca (v15): LibraryPanel hace poll de api.library al montar.
    library: vi.fn(() => Promise.resolve([])),
    restoreLibrary: vi.fn(() => Promise.resolve({ ok: true })),
    deleteLibrary: vi.fn(() => Promise.resolve({ ok: true })),
    libraryShot: vi.fn((slug) => `/api/design-library/${slug}/screenshot`),
    libraryPrompt: vi.fn(() => Promise.resolve({ ok: true, text: '# spec', source: 'spec' })),
  },
}));

const renderTab = async (props = {}) => {
  const utils = render(<MobileTab {...props} />);
  await act(async () => {}); // flush del primer mobileStatus
  return utils;
};

describe('MobileTab', () => {
  it('sin workspace muestra el empty state y crear llama api.createMobile', async () => {
    state.mobile = { exists: false, messages: [] };
    await renderTab();
    expect(screen.getByText('Diseñar app móvil')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Nuevo diseño mobile'));
    });
    expect(api.createMobile).toHaveBeenCalledTimes(1);
  });

  it('con workspace renderiza el historial del chat', async () => {
    state.mobile = {
      exists: true,
      messages: [
        { role: 'user', text: 'una app de hábitos' },
        { role: 'agent', text: 'listo, onboarding con CTA fijo' },
      ],
    };
    await renderTab();
    expect(screen.getByText('una app de hábitos')).toBeTruthy();
    expect(screen.getByText('listo, onboarding con CTA fijo')).toBeTruthy();
  });

  it('enviar un mensaje llama api.mobileChat y muestra el reply en vivo', async () => {
    state.mobile = { exists: true, messages: [] };
    let resolveChat;
    api.mobileChat.mockImplementationOnce((text, { onChunk }) => {
      onChunk('agregando FlatList…');
      return new Promise((r) => {
        resolveChat = r;
      });
    });
    await renderTab();
    const input = screen.getByPlaceholderText('Pedile un cambio al diseñador mobile…');
    fireEvent.change(input, { target: { value: 'lista con FlatList' } });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Enviar'));
    });
    expect(screen.getByText('agregando FlatList…')).toBeTruthy();
    await act(async () => {
      resolveChat({ ok: true, text: 'agregando FlatList…' });
    });
    expect(api.mobileChat).toHaveBeenCalledWith('lista con FlatList', expect.any(Object));
  });

  it('con dev run vivo el preview se renderiza dentro del marco de teléfono', async () => {
    state.mobile = {
      exists: true,
      messages: [],
      devRunning: true,
      urls: ['http://localhost:8081'],
    };
    await renderTab();
    const frame = screen.getByTitle('preview móvil');
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toBe('http://localhost:8081');
    expect(screen.getByText('http://localhost:8081')).toBeTruthy();
  });

  it('guardar llama api.mobileSave con el slug y dispara onSaved', async () => {
    state.mobile = { exists: true, messages: [] };
    const onSaved = vi.fn();
    await renderTab({ onSaved });
    fireEvent.change(screen.getByTestId('mobile-save-name'), {
      target: { value: 'mi-app-movil' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mobile-save'));
    });
    expect(api.mobileSave).toHaveBeenCalledWith('mi-app-movil');
    expect(onSaved).toHaveBeenCalledWith('mi-app-movil');
  });
});
