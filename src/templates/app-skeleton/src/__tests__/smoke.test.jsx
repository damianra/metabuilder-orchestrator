import { render, screen } from '@testing-library/react';
import App from '../App.jsx';

test('la app renderiza el contenedor principal', () => {
  render(<App />);
  expect(screen.getByRole('main')).toBeInTheDocument();
});
