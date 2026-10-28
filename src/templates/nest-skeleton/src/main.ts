import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
await app.listen(Number(process.env.PORT ?? 4000), () =>
  console.log(`api en http://localhost:${process.env.PORT ?? 4000}`),
);
