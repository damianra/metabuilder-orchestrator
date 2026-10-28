import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api.js';
import NewAppForm from '../NewAppForm.jsx';

vi.mock('../../api.js', () => ({
  api: {
    options: vi.fn(() =>
      Promise.resolve({
        scopes: ['fullstack', 'frontend', 'backend'],
        appTypes: ['landing', 'orders'],
        archs: ['flat', 'mvc'],
        stacks: { frontend: ['vite-react'], backend: ['express-sqlite'] },
        engines: ['devin'],
        engine: 'devin',
        compliance: ['cookies', 'auth', 'menores'],
      }),
    ),
    project: vi.fn(() =>
      Promise.resolve({ scope: 'frontend', appType: 'landing', arch: 'flat', stacks: {} }),
    ),
    enqueueRun: vi.fn(() => Promise.resolve({ job: { id: 1 } })),
  },
}));

describe('NewAppForm (v10: backend | fullstack)', () => {
  it('sin fixedScope: select filtra frontend y arranca en backend', async () => {
    render(<NewAppForm />);
    await waitFor(() => expect(api.options).toHaveBeenCalled());
    const select = screen.getByLabelText('Scope');
    const values = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(values).toEqual(['fullstack', 'backend']);
    expect(select.value).toBe('backend');
  });

  it('fixedScope="backend": no hay select y el stack front queda off', async () => {
    render(<NewAppForm fixedScope="backend" />);
    await waitFor(() => expect(api.options).toHaveBeenCalled());
    expect(screen.queryByLabelText('Scope')).toBeNull();
    expect(screen.getByLabelText('Stack front').disabled).toBe(true);
    expect(screen.getByLabelText('Arquitectura').disabled).toBe(false);
  });

  it('fixedScope="fullstack": no hay select y stack front habilitado', async () => {
    render(<NewAppForm fixedScope="fullstack" />);
    await waitFor(() => expect(api.options).toHaveBeenCalled());
    expect(screen.queryByLabelText('Scope')).toBeNull();
    expect(screen.getByLabelText('Stack front').disabled).toBe(false);
  });

  it('menores no se ofrece: la infiere el agente del dominio', async () => {
    render(<NewAppForm />);
    await waitFor(() => expect(api.options).toHaveBeenCalled());
    expect(screen.queryByText('menores')).toBeNull();
    expect(screen.getByText('cookies')).toBeTruthy();
    expect(screen.getByText('auth')).toBeTruthy();
  });

  it('clone de proyecto frontend → scope cae a backend', async () => {
    render(<NewAppForm cloneSlug="mi-front" />);
    await waitFor(() => expect(api.project).toHaveBeenCalledWith('mi-front'));
    const select = await screen.findByLabelText('Scope');
    await waitFor(() => expect(select.value).toBe('backend'));
  });

  it('con scope backend el stack front y gh-pages quedan deshabilitados', async () => {
    render(<NewAppForm />);
    await waitFor(() => expect(api.options).toHaveBeenCalled());
    expect(screen.getByLabelText('Stack front').disabled).toBe(true);
    expect(screen.getByLabelText('Arquitectura').disabled).toBe(false);
  });
});
