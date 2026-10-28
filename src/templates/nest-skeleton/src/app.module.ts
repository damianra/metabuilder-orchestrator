import { Controller, Get, Module } from '@nestjs/common';
import { DatabaseModule } from './database.module.js';
import { ItemsModule } from './items/items.module.js';

@Controller('api')
class AppController {
  @Get('health')
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [DatabaseModule, ItemsModule],
  controllers: [AppController],
})
export class AppModule {}
