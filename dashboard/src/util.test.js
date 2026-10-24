import { describe, expect, it } from 'vitest';
import { jobSummary, statusMeta, timeAgo } from './util.js';

describe('statusMeta', () => {
  it('conoce los estados del pipeline y tolera desconocidos', () => {
    expect(statusMeta('done').label).toBe('done');
    expect(statusMeta('running').cls).toContain('animate-pulse');
    expect(statusMeta('inventado').label).toBe('inventado');
    expect(statusMeta(null).label).toBe('desconocido');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('formatea deltas legibles', () => {
    expect(timeAgo('2026-01-01T11:59:50Z', now)).toBe('hace un momento');
    expect(timeAgo('2026-01-01T11:55:00Z', now)).toBe('hace 5m');
    expect(timeAgo('2026-01-01T09:00:00Z', now)).toBe('hace 3h');
    expect(timeAgo('2025-12-29T12:00:00Z', now)).toBe('hace 3d');
  });
  it('null en timestamp inválido', () => {
    expect(timeAgo('no-es-fecha', now)).toBeNull();
  });
});

describe('jobSummary', () => {
  it('resume jobs de generación con idea + flags', () => {
    expect(jobSummary(['--idea', 'blog de gatos', '--yes', '--scope', 'frontend'])).toBe(
      '"blog de gatos" --yes --scope frontend',
    );
  });
  it('resume jobs de resume con el slug', () => {
    expect(jobSummary(['--resume', 'mi-app', '--yes', '--no-push'])).toBe('resume mi-app --yes --no-push');
  });
  it('tolera args vacíos', () => {
    expect(jobSummary([])).toBe('(sin idea)');
  });
});
