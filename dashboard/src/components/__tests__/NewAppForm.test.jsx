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
        compliance: ['cookies', 'auth'],
      }),
    ),
    project: vi.fn(() =>
      Promise.resolve({ scope: 'frontend', appType: 'landing', arch: 'flat', stacks: {} }),
    ),
    enqueueRun: vi.fn(() => Promise.resolve({ job: { id: 1 } })),
  },
}));

describe('NewAppForm (v10: backend | fullstack)', () => {
  it('scope select no ofrece frontend y arranca en backend', async () => {
    render(<NewAppForm />);
    await waitFor(() => expect(api.options).toHaveBeenCalled());
    const select = screen.getByLabelText('Scope');
    const values = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(values).toEqual(['fullstack', 'backend']);
    expect(select.value).toBe('backend');
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
