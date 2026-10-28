import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from './item.entity.js';

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(Item)
    private readonly repo: Repository<Item>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async create(name: string) {
    const item = await this.repo.save({ name });
    return { id: item.id, name: item.name };
  }

  async remove(id: number) {
    await this.repo.delete(id);
    return { ok: true };
  }
}
