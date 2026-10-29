import 'reflect-metadata';
import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

// SPA del frontend si existe dist/ (fullstack) — NestJS registra sus
// controllers primero así que /api/* siempre gana; el catchall GET
// sirve el index.html para el routing del front.
const http = app.getHttpAdapter().getInstance();
const DIST = join(process.cwd(), 'dist');
http.use(express.static(DIST));
http.use((req, res, next) =>
  req.method === 'GET' && !req.path.startsWith('/api')
    ? res.sendFile(join(DIST, 'index.html'), () => next())
    : next(),
);

await app.listen(Number(process.env.PORT ?? 4000), () =>
  console.log(`api en http://localhost:${process.env.PORT ?? 4000}`),
);
