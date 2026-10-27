import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api.js';
import SetupGate from '../SetupGate.jsx';

vi.mock('../../api.js', () => ({
  api: {
    engines: vi.fn(() =>
      Promise.resolve({
        engine: null,
        engines: [
          { id: 'devin', label: 'Devin CLI', bin: 'devin', installed: true, auth: 'ok' },
          {
            id: 'opencode',
            label: 'OpenCode',
            bin: 'opencode',
            installed: false,
            auth: 'fail',
            installHint: 'npm i -g opencode-ai',
            docsUrl: 'https://opencode.ai',
          },
        ],
      }),
    ),
    saveSettings: vi.fn(() => Promise.resolve({ engine: 'devin' })),
  },
}));

describe('SetupGate', () => {
  it('click en una card la selecciona (ring-sky-600) y habilita "Usar este motor"', async () => {
    render(<SetupGate current={null} onDone={() => {}} />);
    const card = (await screen.findByText('Devin CLI')).closest('button');
    const save = screen.getByRole('button', { name: /usar este motor/i });
    // sin selección el botón queda deshabilitado
    expect(save.disabled).toBe(true);
    expect(card.className).not.toContain('ring-sky-600');
    fireEvent.click(card);
    expect(card.className).toContain('ring-sky-600');
    expect(save.disabled).toBe(false);
  });

  it('confirmar persiste el engine elegido y avisa onDone', async () => {
    const onDone = vi.fn();
    render(<SetupGate current={null} onDone={onDone} />);
    const card = (await screen.findByText('OpenCode')).closest('button');
    fireEvent.click(card);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /usar este motor/i }));
    });
    expect(api.saveSettings).toHaveBeenCalledWith({ engine: 'opencode' });
    expect(onDone).toHaveBeenCalledWith('opencode');
  });
});
