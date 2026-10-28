import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Item } from './items/item.entity.js';

/**
 * DataSource por env: `DB_TYPE=postgres|mysql|mongodb` en .env —
 * un solo skeleton cubre las tres bases. Las entities se agregan al
 * array `entities` (cada recurso nuevo = entity + service +
 * controller + registrar el módulo en app.module). `synchronize`
 * crea/ajusta el schema al arranque (dev) — para migraciones
 * formales usar typeorm migration:generate.
 */
const type = process.env.DB_TYPE || 'postgres';
const common = { entities: [Item], synchronize: process.env.DB_SYNC !== 'false', logging: false };

const config =
  type === 'mongodb'
    ? {
        type: 'mongodb',
        url: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
        database: process.env.DB_NAME || 'app',
        ...common,
      }
    : {
        type,
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || (type === 'mysql' ? 3306 : 5432)),
        database: process.env.DB_NAME || 'app',
        username: process.env.DB_USER || (type === 'mysql' ? 'root' : 'postgres'),
        password: process.env.DB_PASSWORD || '',
        ...common,
      };

@Module({ imports: [TypeOrmModule.forRoot(config as never)] })
export class DatabaseModule {}
