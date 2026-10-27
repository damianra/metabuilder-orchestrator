import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api.js';
import QueuePanel from '../QueuePanel.jsx';

// api.js mockeado: el panel solo toca clearJobs/cancelJob/requeueJob/jobLog.
vi.mock('../../api.js', () => ({
  api: {
    clearJobs: vi.fn(() => Promise.resolve({ cleared: 0 })),
    cancelJob: vi.fn(() => Promise.resolve({})),
    requeueJob: vi.fn(() => Promise.resolve({})),
    jobLog: vi.fn((id) =>
      Promise.resolve({
        jobId: id,
        jobStatus: 'done',
        projectSlug: 'app',
        log: { lines: ['línea uno', 'línea dos'], truncated: false },
      }),
    ),
  },
}));

const job = (id, status, extra = {}) => ({
  id,
  status,
  args: ['--idea', `app ${id}`, '--yes'],
  createdAt: '2026-01-01T10:00:00Z',
  ...(['done', 'failed', 'cancelled'].includes(status)
    ? { finishedAt: '2026-01-01T10:05:30Z' }
    : {}),
  ...extra,
});

describe('QueuePanel', () => {
  it('muestra activos + últimos 5 terminados y avisa los ocultos', () => {
    const jobs = [
      job(1, 'running'),
      job(2, 'pending'),
      job(3, 'done'),
      job(4, 'done'),
      job(5, 'failed'),
      job(6, 'done'),
      job(7, 'cancelled'),
      job(8, 'done'),
    ];
    const { container } = render(<QueuePanel jobs={jobs} worker={null} />);
    // 2 activos + 5 terminados visibles (el 6to queda oculto)
    expect(container.querySelectorAll('li')).toHaveLength(7);
    expect(screen.getByText('…y 1 terminados más')).toBeTruthy();
    // el job terminado más viejo (#3) no se renderiza
    expect(screen.queryByText(/#3 /)).toBeNull();
  });

  it('limpiar terminados llama api.clearJobs y avisa onChanged', async () => {
    const onChanged = vi.fn();
    render(<QueuePanel jobs={[job(1, 'done'), job(2, 'failed')]} worker={null} onChanged={onChanged} />);
    await act(async () => {
      fireEvent.click(screen.getByText('limpiar terminados'));
    });
    expect(api.clearJobs).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalled();
  });

  it('expandir un job fetchea su log on-demand y muestra las líneas', async () => {
    const { container } = render(<QueuePanel jobs={[job(9, 'done')]} worker={null} />);
    // cerrado → no hay pre ni fetch
    expect(container.querySelector('pre')).toBeNull();
    expect(api.jobLog).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTitle('Ver log del job'));
    });
    expect(api.jobLog).toHaveBeenCalledWith(9, 15);
    expect(container.querySelector('pre')?.textContent).toContain('línea uno');
  });
});
