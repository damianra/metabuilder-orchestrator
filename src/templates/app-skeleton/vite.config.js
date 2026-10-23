import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // base relativa: los assets resuelven en subrutas (GitHub Pages /<repo>/)
  base: './',
  plugins: [react()],
  // proxy dev → api-skeleton (Express en :4000). Config muerta si el
  // scope no tiene backend: nada consulta /api ni /uploads.
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
