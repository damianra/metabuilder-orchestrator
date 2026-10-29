import 'reflect-metadata';
import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
// SPA: static + catchall registrados ANTES de los controllers (init,
// llamada por listen, los bindea junto al 404-handler — si fueran
// post-init quedarían detrás del 404 de Nest y serían código muerto).
// /api/* cae a Nest (ruta montada o su 404 JSON); el resto de GETs
// sirve index.html si existe dist/. La convención exige
// @Controller('api/...'): un controller fuera de /api quedaría
// sombreado por el catchall. dist/ solo existe en apps fullstack.
const http = app.getHttpAdapter().getInstance();
// buildDir del front: vite → dist/, nextjs → out/ (stack.buildDir).
const DIST = ['dist', 'out'].map((d) => join(process.cwd(), d)).find((d) => existsSync(join(d, 'index.html'))) ?? join(process.cwd(), 'dist');
http.use(express.static(DIST));
http.use((req, res, next) =>
  req.method === 'GET' && !req.path.startsWith('/api')
    ? res.sendFile(join(DIST, 'index.html'), (err) => { if (err) next(); })
    : next(),
);

await app.listen(Number(process.env.PORT ?? 4000), () =>
  console.log(`api en http://localhost:${process.env.PORT ?? 4000}`),
);
