import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // proxy dev → API del dashboard (Express en :4100, npm run dashboard:api)
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': {
        target: `http://${process.env.DASHBOARD_HOST ?? '127.0.0.1'}:${process.env.DASHBOARD_PORT ?? 4100}`,
        ws: true, // terminal Devin (WS) viaja por /api/projects/:slug/terminal
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [...configDefaults.exclude],
  },
});
