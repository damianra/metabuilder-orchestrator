import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { toId } from '../database.module.js';
import { ItemsService } from './items.service.js';

/**
 * CRUD de muestra — @Controller('api/items') + método por endpoint.
 * Convención: agregar recurso = entity + service + controller +
 * ItemsModule-like en app.module. Validación 400 con
 * BadRequestException, respuestas planas (Nest serializa a JSON).
 */
@Controller('api/items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  list() {
    return this.items.findAll();
  }

  @Post()
  create(@Body() body: { name?: string }) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('name requerido');
    return this.items.create(name);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.items.remove(toId(id));
  }
}
