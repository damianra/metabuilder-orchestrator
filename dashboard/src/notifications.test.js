import { describe, expect, it } from 'vitest';
import { diffFinished, notifyFinished, snapshotStatuses } from './notifications.js';

const job = (id, status, args = ['--idea', 'blog']) => ({ id, status, args });

describe('diffFinished', () => {
  it('primer poll (prev null) → no notifica nada', () => {
    expect(diffFinished(null, [job(1, 'done'), job(2, 'failed')])).toEqual([]);
  });

  it('detecta transición pending/running → terminal', () => {
    const prev = snapshotStatuses([job(1, 'running'), job(2, 'pending'), job(3, 'running')]);
    const next = [job(1, 'done'), job(2, 'running'), job(3, 'failed')];
    expect(diffFinished(prev, next).map((j) => j.id)).toEqual([1, 3]);
  });

  it('cancelled también es terminal', () => {
    const prev = snapshotStatuses([job(1, 'running')]);
    expect(diffFinished(prev, [job(1, 'cancelled')])).toHaveLength(1);
  });

  it('terminal → terminal no re-notifica; job nuevo en terminal tampoco', () => {
    const prev = snapshotStatuses([job(1, 'failed')]);
    const next = [job(1, 'failed'), job(2, 'done')];
    expect(diffFinished(prev, next)).toEqual([]);
  });
});

describe('notifyFinished', () => {
  it('dispara Notification solo con permiso granted y pestaña oculta', () => {
    const calls = [];
    class FakeNotification {
      constructor(title, opts) {
        calls.push({ title, opts });
      }
      static permission = 'granted';
    }
    globalThis.window = {
      Notification: FakeNotification,
      focus: () => {},
    };
    globalThis.Notification = FakeNotification;
    let hidden = true;
    Object.defineProperty(globalThis, 'document', {
      value: { get hidden() { return hidden; } },
      configurable: true,
    });

    notifyFinished(job(7, 'done'));
    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe('Job #7 terminó');
    expect(calls[0].opts.body).toContain('blog');
    expect(calls[0].opts.tag).toBe('job-7');

    hidden = false; // pestaña visible → no notifica
    notifyFinished(job(8, 'failed'));
    expect(calls).toHaveLength(1);

    FakeNotification.permission = 'denied';
    hidden = true;
    notifyFinished(job(9, 'done'));
    expect(calls).toHaveLength(1);
  });
});
