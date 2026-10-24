import { render, screen } from '@testing-library/react';
import Home from '../app/page.jsx';

test('la app renderiza el contenedor principal', () => {
  render(<Home />);
  expect(screen.getByRole('main')).toBeInTheDocument();
});
