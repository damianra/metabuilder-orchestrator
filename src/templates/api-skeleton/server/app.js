import express from 'express';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * App Express base. Convención de auto-mount: cada archivo
 * server/routes/<name>.js que exporte un Router default se monta en
 * /api/<name> — agregar un endpoint es agregar un archivo, no hay
 * nada que registrar.
 */
export async function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Archivos subidos via POST /api/uploads (routes/uploads.js)
  app.use('/uploads', express.static(join(here, 'uploads')));

  const routesDir = join(here, 'routes');
  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith('.js')) continue;
    const name = file.slice(0, -3);
    const { default: router } = await import(`./routes/${name}.js`);
    app.use(`/api/${name}`, router);
  }

  // Frontend build estático (fullstack): dist/ en la raíz del proyecto.
  const distDir = join(here, '..', 'dist');
  const indexHtml = join(distDir, 'index.html');
  if (existsSync(indexHtml)) {
    app.use(express.static(distDir));
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // SPA fallback: GETs que no son /api ni archivos estáticos → index.html.
  if (existsSync(indexHtml)) {
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(indexHtml);
    });
  }

  // eslint-disable-next-line no-unused-vars -- Express reconoce el error handler por aridad
  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.name === 'MulterError' ? 400 : (err.status ?? 500);
    res.status(status).json({ error: err.message ?? 'internal error' });
  });
  return app;
}
