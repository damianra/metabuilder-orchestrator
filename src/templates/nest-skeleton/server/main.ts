import 'reflect-metadata';
import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
// Los controllers de Nest se bindean en init() — los middlewares SPA
// se registran DESPUÉS para no sombrearlos (un @Controller fuera de
// /api seguiría ganando al catchall). dist/ solo existe en fullstack.
await app.init();
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
