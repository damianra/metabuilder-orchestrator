import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProjectList from '../ProjectList.jsx';

const project = (slug, status, extra = {}) => ({
  slug,
  name: `App ${slug}`,
  status,
  scope: 'frontend',
  appType: 'landing',
  steps: { done: 2, total: 4 },
  updatedAt: '2026-01-01T10:00:00Z',
  ...extra,
});

const projects = [
  project('blog-gatos', 'done'),
  project('landing-vet', 'running', { hasRemote: true }),
  project('api-pedidos', 'failed'),
];

const searchBox = () => screen.getByPlaceholderText(/filtrar por slug/i);

describe('ProjectList', () => {
  it('filtra la grilla por slug (case-insensitive)', () => {
    render(<ProjectList projects={projects} />);
    expect(screen.getByText('App blog-gatos')).toBeTruthy();
    fireEvent.change(searchBox(), { target: { value: 'BLOG' } });
    expect(screen.getByText('App blog-gatos')).toBeTruthy();
    expect(screen.queryByText('App landing-vet')).toBeNull();
    expect(screen.queryByText('App api-pedidos')).toBeNull();
  });

  it('filtra por status y muestra empty state sin matches', () => {
    render(<ProjectList projects={projects} />);
    fireEvent.change(searchBox(), { target: { value: 'failed' } });
    expect(screen.getByText('App api-pedidos')).toBeTruthy();
    expect(screen.queryByText('App blog-gatos')).toBeNull();
    fireEvent.change(searchBox(), { target: { value: 'zzz' } });
    expect(screen.getByText("sin resultados para 'zzz'")).toBeTruthy();
  });

  it('muestra el chip repo solo cuando hasRemote', () => {
    const { container } = render(<ProjectList projects={projects} />);
    const chips = [...container.querySelectorAll('a')].filter((a) =>
      a.textContent.includes('repo'),
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('landing-vet');
  });
});
