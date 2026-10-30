// Smoke del kit de componentes — verifica que los bloques pre-styled
// renderizan (el diseño real lo arma el agente encima de estos).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Card,
  CTA,
  EmptyState,
  ErrorState,
  FormShell,
  Hero,
  Navbar,
  Section,
  StatCard,
} from '../components/ui.jsx';

describe('ui kit', () => {
  it('todos los bloques renderizan', () => {
    render(
      <div>
        <Navbar brand="App" links={[{ href: '#a', label: 'A' }]} />
        <Hero badge="nuevo" title="Título" subtitle="Sub" cta={{ href: '#x', label: 'Ir' }} />
        <Section id="s">
          <Card title="Card">contenido</Card>
          <StatCard label="Total" value="42" />
          <EmptyState message="nada" />
          <ErrorState message="falló" />
          <FormShell title="Form" disabled submitLabel="Enviar">
            <input />
          </FormShell>
        </Section>
        <CTA title="CTA" cta={{ href: '#y', label: 'Ya' }} />
      </div>,
    );
    expect(screen.getByText('Título')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Algo salió mal')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Enviar' });
    expect(btn).toBeDisabled();
  });

  it('FormShell habilita el submit cuando disabled=false', () => {
    render(
      <FormShell disabled={false} submitLabel="Enviar">
        <input />
      </FormShell>,
    );
    expect(screen.getByRole('button', { name: 'Enviar' })).not.toBeDisabled();
  });
});
