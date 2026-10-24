/** @type {import('next').NextConfig} */
const config = {
  // Export estático → out/ servible por cualquier static host (Pages,
  // nginx, o el propio Express del api-skeleton que sirve out/).
  output: 'export',
  images: { unoptimized: true },
  // GitHub Pages publica en /<repo>/: el finalize re-buildea con
  // PAGES_BASE=/<repo>. Vacío en dev/local → rutas absolutas limpias.
  basePath: process.env.PAGES_BASE || '',
  // Proxy de dev → api-skeleton (:4000), mismo rol que el proxy de
  // Vite en el otro skeleton. Solo en dev: en export estático los
  // rewrites no aplican y en producción Express sirve todo junto.
  ...(process.env.NODE_ENV === 'development'
    ? {
        async rewrites() {
          return [
            { source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' },
            { source: '/uploads/:path*', destination: 'http://localhost:4000/uploads/:path*' },
          ];
        },
      }
    : {}),
};

export default config;
