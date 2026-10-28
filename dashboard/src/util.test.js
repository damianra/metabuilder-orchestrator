import { describe, expect, it } from 'vitest';
import { jobSummary, parseProposal, statusMeta, timeAgo } from './util.js';

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

describe('parseProposal', () => {
  const withProposal = (inner) => `Listo, quedó el hero.\n\n\`\`\`proposal\n${inner}\n\`\`\``;

  it('sin bloque → proposal null y texto intacto', () => {
    expect(parseProposal('hola')).toEqual({ text: 'hola', proposal: null });
    expect(parseProposal(null)).toEqual({ text: null, proposal: null });
  });

  it('bloque válido → question + opciones, texto limpio', () => {
    const { text, proposal } = parseProposal(
      withProposal(
        '{"question":"¿seguimos?","options":[{"label":"Guardar","action":"save"},{"label":"Iterar","reply":"seguí"}]}',
      ),
    );
    expect(text).toBe('Listo, quedó el hero.');
    expect(proposal.question).toBe('¿seguimos?');
    expect(proposal.options).toHaveLength(2);
    expect(proposal.options[0].action).toBe('save');
  });

  it('JSON malformado o sin opciones válidas → null', () => {
    expect(parseProposal(withProposal('{roto')).proposal).toBeNull();
    expect(parseProposal(withProposal('{"question":"x","options":[]}')).proposal).toBeNull();
    // opciones sin label se filtran; si no queda ninguna → null
    expect(
      parseProposal(withProposal('{"options":[{"reply":"sin label"}]}')).proposal,
    ).toBeNull();
  });

  it('clampa a 4 opciones y tolera question ausente', () => {
    const inner = JSON.stringify({
      options: [1, 2, 3, 4, 5].map((n) => ({ label: `op${n}` })),
    });
    const { proposal } = parseProposal(withProposal(inner));
    expect(proposal.options).toHaveLength(4);
    expect(proposal.question).toBe('');
  });
});
